import { AetherOpsShell } from "./app/AetherOpsShell";
import { useAetherOpsController } from "./app/useAetherOpsController";

export default function App() {
  return <AetherOpsShell controller={useAetherOpsController()} />;
}
