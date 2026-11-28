import { useMutation } from "@tanstack/react-query";
import { Power } from "lucide-react";
import { useState } from "react";

import { Button } from "src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { api } from "src/queries/api";

// Stops the server: the page, the share link and the session's listener all end with it, so it asks first.
export function ShutdownButton() {
  const [open, setOpen] = useState(false);
  const stop = useMutation({ mutationFn: () => api.post("shutdown").json() });

  if (stop.isSuccess) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-background p-4 text-center">
        <div>
          <p className="font-medium">The dashboard has stopped.</p>
          <p className="text-muted-foreground text-sm">Ask Claude to open it again when you need it.</p>
        </div>
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Stop the dashboard"
          className="grid size-7 cursor-pointer place-items-center rounded-full border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground"
        >
          <Power className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3 text-sm">
        <p>Stop the dashboard? This page, its share link and Claude's listener all stop.</p>
        {stop.isError && <p className="text-danger">The server didn't stop. Try again, or ask Claude to stop it.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-danger text-background hover:bg-danger/90"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            Stop
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
