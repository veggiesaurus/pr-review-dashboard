import { X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, useState } from "react";

import { api } from "src/queries/api";
import { errorText } from "src/queries/messages.mutation";

const MAX = 6;

// Screenshots dropped or pasted into a box, uploaded as they arrive; images holds the ids to send with the message.
export function useScreenshots() {
  const [images, setImages] = useState<string[]>([]);
  // Counted rather than one mutation's state, which only follows the last file of several dropped at once.
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const take = (files: FileList) => {
    const shots = [...files].filter(file => file.type.startsWith("image/"));
    setError(null);
    for (const file of shots.slice(0, MAX - images.length)) {
      setUploading(n => n + 1);
      api
        .post("attachments", { body: file, timeout: 60_000 })
        .json<{ id: string }>()
        .then(({ id }) => setImages(list => (list.includes(id) ? list : [...list, id].slice(0, MAX))))
        .catch(failure => setError(errorText(failure, "A screenshot didn't attach.")))
        .finally(() => setUploading(n => n - 1));
    }
    return shots.length > 0;
  };
  // The editor takes what lands on it first; these catch what lands around it.
  const handlers = {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
      }
    },
    onDrop: (event: DragEvent) => {
      if (!event.defaultPrevented && event.dataTransfer.files.length > 0) {
        event.preventDefault();
        take(event.dataTransfer.files);
      }
    },
    onPaste: (event: ClipboardEvent) => {
      if (!event.defaultPrevented && take(event.clipboardData.files)) {
        event.preventDefault();
      }
    },
  };
  return {
    images,
    handlers,
    take,
    uploading: uploading > 0,
    error,
    remove: (id: string) => setImages(list => list.filter(other => other !== id)),
    clear: () => setImages([]),
  };
}

// Thumbnails that open the full image; with onRemove, each has a button to take it off again.
export function Screenshots({ ids, onRemove }: { ids?: string[]; onRemove?: (id: string) => void }) {
  if (!ids?.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map(id => (
        <span key={id} className="relative">
          <a href={`/api/attachments/${id}`} target="_blank" rel="noreferrer" title="Open the full screenshot">
            <img src={`/api/attachments/${id}`} alt="Attached screenshot" className="h-16 max-w-40 rounded-md border object-cover" />
          </a>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label="Remove this screenshot"
              className="absolute -top-1.5 -right-1.5 grid size-4 cursor-pointer place-items-center rounded-full bg-foreground text-background"
            >
              <X className="size-3" strokeWidth={2.5} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
