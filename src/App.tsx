import { Route, Routes } from "react-router-dom";
import Hub from "./components/Hub";
import DemoPage from "./components/DemoPage";
import NotFound from "./components/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Hub />} />
      <Route path="/demo/:id" element={<DemoPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
