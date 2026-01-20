import { useEffect, useMemo, useState } from "react";
import RequestBuilder from "./components/RequestBuilder";
import ResponseViewer from "./components/ResponseViewer";
import HistoryPanel from "./components/HistoryPanel";
import { addToHistory, loadHistory, saveHistory } from "./utils/storage";
import "./App.css";

const THEME_KEY = "bhejo_theme_v1";

export default function App() {
  const [response, setResponse] = useState(null);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const handleSaveHistory = (item) => {
    const updated = addToHistory(item);
    setHistory(updated);
  };

  const handleClearHistory = () => {
    saveHistory([]);
    setHistory([]);
    setSelected(null);
    setResponse(null);
  };

  const subtitle = useMemo(() => "Minimal API client • Phase 1", []);

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <h1>Bhejo</h1>
          <p>{subtitle}</p>
        </div>

        <div className="headerRight">
          <span className="badge">Local only</span>

          <button
            className="themeToggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            <span className="themeIcon">{theme === "dark" ? "🌙" : "☀️"}</span>
            <span className="themeText">{theme === "dark" ? "Dark" : "Light"}</span>
            <span className="themeKnob" />
          </button>
        </div>
      </div>

      <div className="layout">
        {/* LEFT: History */}
        <div className="panel">
          <div className="panelHeader">
            <div className="panelTitle">History</div>
            <button className="btn btnDanger btnSm" onClick={handleClearHistory}>
              Clear
            </button>
          </div>
          <div className="panelBody sidebarBody">
            <HistoryPanel history={history} onSelect={setSelected} />
          </div>
        </div>

        {/* RIGHT: Main */}
        <div className="stack mainStack">
          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Request</div>
              <span className="badge">Fetch</span>
            </div>
            <div className="panelBody">
              <RequestBuilder
                initial={selected}
                onResponse={setResponse}
                onSaveHistory={handleSaveHistory}
              />
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Response</div>
              <span className="badge">Preview</span>
            </div>
            <div className="panelBody">
              <ResponseViewer response={response} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
