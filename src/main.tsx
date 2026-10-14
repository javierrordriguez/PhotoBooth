import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Booth } from "./features/booth/Booth";
import { Gallery } from "./gallery/Gallery";
import "./style.css";
function Pending({ title }: { title: string }) {
  return (
    <main className="placeholder">
      <span className="eyebrow">TAMI · PHOTO BOOTH</span>
      <h1>{title}</h1>
      <p>
        Esta función estará disponible en una próxima fase. Esta versión guarda
        copias locales y respaldo privado en Supabase.
      </p>
      <Link className="button" to="/booth">
        Volver a la cabina
      </Link>
    </main>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/booth" element={<Booth />} />
        <Route path="/admin" element={<Pending title="Administración" />} />
        <Route path="/s/:token" element={<Gallery />} />
        <Route path="*" element={<Navigate to="/booth" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
