import type { LocalEdit } from "shared/local";
import { plural } from "src/components/guide/visible";
import { Button } from "src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "src/components/ui/dialog";
import { useLocalChanges, useRevertLocal } from "src/queries/local.query";
import { errorText } from "src/queries/messages.mutation";

// Asks before the checkout is changed: the page can't put a reverted edit back.
export function RevertDialog({
  layer,
  file,
  path,
  edit,
  onClose,
}: {
  layer: number;
  file: string;
  path: string;
  edit: LocalEdit;
  onClose: () => void;
}) {
  const where = useLocalChanges(layer).data?.where;
  const revert = useRevertLocal(layer);
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Revert this change in your checkout?</DialogTitle>
        <DialogDescription>
          This puts the reviewed code back in <code className="font-mono text-[13px]">{path}</code>
          {where && (
            <>
              {" "}
              in <code className="font-mono text-[13px]">{where}</code>
            </>
          )}
          , taking out {plural(edit.add.length, "local line")}
          {edit.gone.length > 0 && <> and restoring {plural(edit.gone.length, "reviewed line")}</>}. The rest of the file stays as it is,
          and Claude is told. The page can't undo it.
        </DialogDescription>
        {revert.isError && <p className="text-danger text-sm">{errorText(revert.error)}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="border-danger text-danger hover:bg-danger/10"
            disabled={revert.isPending}
            onClick={() => revert.mutate({ file, edit }, { onSuccess: onClose })}
          >
            Revert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
