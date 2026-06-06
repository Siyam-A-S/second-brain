import { useState } from "react";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { TopicCanvas } from "../components/TopicCanvas";

export function MainApp(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastDropResult, setLastDropResult] = useState<ProcessDroppedItemsResult | null>(null);

  function handleDropProcessed(result: ProcessDroppedItemsResult): void {
    setLastDropResult(result);
    setRefreshKey((key) => key + 1);
  }

  return (
    <div className="flex h-full flex-col bg-floral text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar onDropProcessed={handleDropProcessed} />
        <TopicCanvas lastDropResult={lastDropResult} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
