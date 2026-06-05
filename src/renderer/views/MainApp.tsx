import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { TopicCanvas } from "../components/TopicCanvas";

export function MainApp(): JSX.Element {
  return (
    <div className="flex h-full flex-col bg-floral text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <TopicCanvas />
      </div>
    </div>
  );
}
