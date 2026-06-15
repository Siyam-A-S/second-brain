import type { DroppedFile, FilesDroppedPayload } from "../../shared/ipc";

type ElectronFile = File & {
  path?: string;
};

function usableElectronPath(file: File): string | undefined {
  const electronPath = (file as ElectronFile).path?.trim();

  if (!electronPath || electronPath === file.name) {
    return undefined;
  }

  return electronPath;
}

export async function createDropPayload(
  source: FilesDroppedPayload["source"],
  dataTransfer: DataTransfer
): Promise<FilesDroppedPayload> {
  const files: DroppedFile[] = await Promise.all(
    Array.from(dataTransfer.files).map(async (file) => {
      const filePath = usableElectronPath(file);

      return {
        name: file.name,
        path: filePath,
        type: file.type,
        size: file.size,
        buffer: filePath ? undefined : await file.arrayBuffer()
      };
    })
  );

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
