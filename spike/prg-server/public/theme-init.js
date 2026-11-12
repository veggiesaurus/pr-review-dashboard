// Runs before first paint so a saved theme or palette never flashes. System needs nothing: the CSS follows the OS.
try {
  var saved = localStorage.getItem("prg:theme");
  if (saved) document.documentElement.dataset.theme = saved;
  var palette = JSON.parse(localStorage.getItem("prg:palette") || "null");
  if (palette && typeof palette.name === "string" && typeof palette.css === "string") {
    var style = document.createElement("style");
    style.id = "prg-palette";
    style.textContent = palette.css;
    document.head.appendChild(style);
    document.documentElement.dataset.palette = palette.name;
  }
} catch (e) {}
