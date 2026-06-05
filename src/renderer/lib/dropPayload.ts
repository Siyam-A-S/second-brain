import type { DroppedFile, FilesDroppedPayload } from "../../shared/ipc";

type ElectronFile = File & {
  path?: string;
};

export function createDropPayload(
  source: FilesDroppedPayload["source"],
  dataTransfer: DataTransfer
): FilesDroppedPayload {
  const files: DroppedFile[] = Array.from(dataTransfer.files).map((file) => {
    const electronFile = file as ElectronFile;

    return {
      name: file.name,
      path: electronFile.path ?? file.name,
      type: file.type,
      size: file.size
    };
  });

  const text = dataTransfer.getData("text/plain") || undefined;

  const payload: FilesDroppedPayload = {
    source,
    files
  };

  if (text) {
    payload.text = text;
  }

  return payload;
}
