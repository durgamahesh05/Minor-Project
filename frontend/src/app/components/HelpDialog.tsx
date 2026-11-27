import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import ContactCard from "./ContactCard";
import { useTranslation } from "react-i18next";

export default function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 border-0 bg-transparent shadow-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("help")}</DialogTitle>
          <DialogDescription>{t("helpDialog.description")}</DialogDescription>
        </DialogHeader>
        <ContactCard />
      </DialogContent>
    </Dialog>
  );
}
