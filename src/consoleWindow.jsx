import React from "react";
import ReactDOM from "react-dom/client";
import ConsolePanel from "./components/ConsolePanel";
import "./App.css";

function ConsoleApp() {
  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <h1>Bhejo Console</h1>
          <p>Live logs (Local)</p>
        </div>
        <span className="badge">Local only</span>
      </div>

      <div className="panel">
        <div className="panelBody">
          <ConsolePanel />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConsoleApp />
  </React.StrictMode>
);
