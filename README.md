# RINA Interactive Diagram

An interactive architectural diagram of **RINA (Recursive InterNetwork Architecture)** based on John Day's design. Built with React and SVG.

**[Live Demo](https://lucastsui.github.io/rina-diagram/)**

## Views

- **Architecture Overview** — Full system layout with two communicating Application Processes, IPC API, DIF internals, and recursive (N-1)-DIF
- **Data Flow Path** — Step-by-step path of an SDU from source AP to destination AP
- **EFCP Internals** — DTP, DTCP, and State Vector structure per-flow
- **Flow Allocation** — Sequence diagram showing the full flow allocation process

Click any component for detailed spec information. Scroll to zoom, drag to pan.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## License

[MIT](LICENSE)
