# Theon Planar AI source

This standalone application snapshot was imported from the attached Theon
workspace. It is kept in its own directory so its TanStack/Vite application
does not replace TheoLab's existing Vanilla JavaScript app.

The character implementation is in `src/theon/engine.js`, its interface in
`src/theon/markup.html`, and its styles in `src/styles/theon.css`. The home
route mounts the interface and starts/stops the 3D engine.

The identity is implemented as application behavior rather than a separate
LLM persona configuration: the engine defines seven expression presets,
Vietnamese sample documents, and text-based expression detection. The Asaro
head and scene are generated in Three.js code; no separate character model
asset is needed.

Workspace-only Grok instructions/configuration, caches/build output, screenshots,
and attached prompt files are intentionally not included.
