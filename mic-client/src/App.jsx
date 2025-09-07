import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import UploadPitch from "./UploadPitch";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <div>
        {/* Your component lives here */}
        <hr />
        <UploadPitch />
      </div>
    </>
  );
}
