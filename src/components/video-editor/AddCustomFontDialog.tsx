import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	addCustomFont,
	type CustomFont,
	generateFontId,
	isValidGoogleFontsUrl,
	parseFontFamilyFromImport,
} from "@/lib/customFonts";

interface AddCustomFontDialogProps {
	onFontAdded?: (font: CustomFont) => void;
}

export function AddCustomFontDialog({ onFontAdded }: AddCustomFontDialogProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [importUrl, setImportUrl] = useState("");
	const [fontName, setFontName] = useState("");
	const [loading, setLoading] = useState(false);

	const handleImportUrlChange = (url: string) => {
		setImportUrl(url);

		// Auto-extract font name if valid Google Fonts URL
		if (isValidGoogleFontsUrl(url)) {
			const extracted = parseFontFamilyFromImport(url);
			if (extracted && !fontName) {
				setFontName(extracted);
			}
		}
	};

	const handleAdd = async () => {
		// Validate inputs
		if (!importUrl.trim()) {
			toast.error(t("addFont.enterImportUrl"));
			return;
		}

		if (!isValidGoogleFontsUrl(importUrl)) {
			toast.error(t("addFont.invalidUrl"));
			return;
		}

		if (!fontName.trim()) {
			toast.error(t("addFont.enterFontName"));
			return;
		}

		setLoading(true);

		try {
			// Extract font family from URL
			const fontFamily = parseFontFamilyFromImport(importUrl);
			if (!fontFamily) {
				toast.error(t("addFont.cantExtractFamily"));
				setLoading(false);
				return;
			}

			// Create custom font object
			const newFont: CustomFont = {
				id: generateFontId(fontName),
				name: fontName.trim(),
				fontFamily: fontFamily,
				importUrl: importUrl.trim(),
			};

			// Add font (this will load and verify it) - throws if it fails
			await addCustomFont(newFont);

			// Notify parent
			if (onFontAdded) {
				onFontAdded(newFont);
			}

			toast.success(t("addFont.fontAdded", { name: fontName }));

			// Reset and close
			setImportUrl("");
			setFontName("");
			setOpen(false);
		} catch (error) {
			console.error("Failed to add custom font:", error);
			const errorMessage = error instanceof Error ? error.message : "Failed to load font";
			toast.error(t("addFont.failedToAddFont"), {
				description: errorMessage.includes("timeout")
					? t("addFont.fontTimeout")
					: t("addFont.fontLoadError"),
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="w-full bg-white/5 border-white/10 text-slate-200 hover:bg-white/10 h-9 text-xs"
				>
					<Plus className="w-3 h-3 mr-1" />
					{t("addFont.addGoogleFont")}
				</Button>
			</DialogTrigger>
			<DialogContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
				<DialogHeader>
					<DialogTitle>{t("addFont.addGoogleFont")}</DialogTitle>
					<DialogDescription className="text-slate-400">
						{t("addFont.addGoogleFontDesc")}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 mt-4">
					<div className="space-y-2">
						<Label htmlFor="import-url" className="text-slate-200">
							{t("addFont.googleFontsImportUrl")}
						</Label>
						<Input
							id="import-url"
							placeholder="https://fonts.googleapis.com/css2?family=Roboto&display=swap"
							value={importUrl}
							onChange={(e) => handleImportUrlChange(e.target.value)}
							className="bg-white/5 border-white/10 text-slate-200"
						/>
						<p className="text-xs text-slate-400">
							{t("addFont.googleFontsUrlHint")}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="font-name" className="text-slate-200">
							{t("addFont.displayName")}
						</Label>
						<Input
							id="font-name"
							placeholder="My Custom Font"
							value={fontName}
							onChange={(e) => setFontName(e.target.value)}
							className="bg-white/5 border-white/10 text-slate-200"
						/>
						<p className="text-xs text-slate-400">
							{t("addFont.displayNameHint")}
						</p>
					</div>

					<div className="flex justify-end gap-2 mt-6">
						<Button
							variant="outline"
							onClick={() => setOpen(false)}
							className="bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
						>
							{t("addFont.cancel")}
						</Button>
						<Button
							onClick={handleAdd}
							disabled={loading}
							className="bg-blue-600 hover:bg-blue-700 text-white"
						>
							{loading ? t("addFont.adding") : t("addFont.addFont")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
