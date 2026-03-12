import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { registerIpcHandlers } from "./ipc/handlers";
import { createEditorWindow, createHudOverlayWindow, createSourceSelectorWindow } from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Screen & System Audio Recording permissions instead of CoreAudio Tap API on macOS.
// CoreAudio Tap requires NSAudioCaptureUsageDescription in the parent app's Info.plist,
// which doesn't work when running from a terminal/IDE during development, makes my life easier
if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let selectedSourceName = "";

// Tray Icons
const defaultTrayIcon = getTrayIcon("openscreen.png");
const recordingTrayIcon = getTrayIcon("rec-button.png");

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];

	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	template.push(
		{
			label: "文件",
			submenu: [
				{
					label: "加载项目…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: "保存项目…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: "另存项目…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const, label: "退出" }]),
			],
		},
		{
			label: "编辑",
			submenu: [
				{ role: "undo", label: "撤销" },
				{ role: "redo", label: "重做" },
				{ type: "separator" },
				{ role: "cut", label: "剪切" },
				{ role: "copy", label: "复制" },
				{ role: "paste", label: "粘贴" },
				{ role: "selectAll", label: "全选" },
			],
		},
		{
			label: "视图",
			submenu: [
				{ role: "reload", label: "重新加载" },
				{ role: "forceReload", label: "强制重新加载" },
				{ role: "toggleDevTools", label: "开发者工具" },
				{ type: "separator" },
				{ role: "resetZoom", label: "重置缩放" },
				{ role: "zoomIn", label: "放大" },
				{ role: "zoomOut", label: "缩小" },
				{ type: "separator" },
				{ role: "togglefullscreen", label: "全屏" },
			],
		},
		{
			label: "窗口",
			submenu: isMac
				? [{ role: "minimize", label: "最小化" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize", label: "最小化" }, { role: "close", label: "关闭" }],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
}

function getTrayIcon(filename: string) {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename))
		.resize({
			width: 24,
			height: 24,
			quality: "best",
		});
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
	const trayToolTip = recording ? `正在录制: ${selectedSourceName}` : "OpenScreen";
	const menuTemplate = recording
		? [
				{
					label: "停止录制",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: "打开",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.isMinimized() && mainWindow.restore();
						} else {
							createWindow();
						}
					},
				},
				{
					label: "退出",
					click: () => {
						app.quit();
					},
				},
			];
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

let editorHasUnsavedChanges = false;
let isForceClosing = false;

ipcMain.on("set-has-unsaved-changes", (_, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function createEditorWindowWrapper() {
	if (mainWindow) {
		isForceClosing = true;
		mainWindow.close();
		isForceClosing = false;
		mainWindow = null;
	}
	mainWindow = createEditorWindow();
	editorHasUnsavedChanges = false;

	mainWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) return;

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(mainWindow!, {
			type: "warning",
			buttons: ["保存并关闭", "放弃并关闭", "取消"],
			defaultId: 0,
			cancelId: 2,
			title: "未保存的更改",
			message: "您有未保存的更改。",
			detail: "关闭前是否要保存项目？",
		});

		if (choice === 0) {
			// Save & Close — tell renderer to save, then close
			mainWindow!.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", () => {
				isForceClosing = true;
				mainWindow?.close();
				isForceClosing = false;
			});
		} else if (choice === 1) {
			// Discard & Close
			isForceClosing = true;
			mainWindow?.close();
			isForceClosing = false;
		}
		// choice === 2: Cancel — do nothing, window stays open
	});
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
	// Keep app running (macOS behavior)
});

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	// Allow microphone/media permission checks
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone"];
		callback(allowed.includes(permission));
	});

	// Request microphone permission from macOS
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	}

	// Listen for HUD overlay quit event (macOS only)
	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});
	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (!recording) {
				if (mainWindow) mainWindow.restore();
			}
		},
	);
	createWindow();
});
