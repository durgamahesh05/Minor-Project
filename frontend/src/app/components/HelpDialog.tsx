import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import ContactCard from "./ContactCard";

export default function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 border-0 bg-transparent shadow-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>Send us a message</DialogDescription>
        </DialogHeader>
        <ContactCard />
      </DialogContent>
    </Dialog>
  );
}
