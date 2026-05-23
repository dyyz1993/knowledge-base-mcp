import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import compression from "vite-plugin-compression"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    compression({ algorithm: "gzip", threshold: 1024 }),
  ],
  server: {
    port: 5180,
    proxy: {
      "/api": "http://localhost:19877",
      "/sse": "http://localhost:19877",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("mermaid") || id.includes("katex") || id.includes("d3-") || id.includes("dagre") || id.includes("elkjs") || id.includes("@braintree/sanitize-url") || id.includes("dayjs") || id.includes("cytoscape") || id.includes("khroma") || id.includes("stylis")) return "vendor-mermaid"
          if (id.includes("antd") || id.includes("@ant-design") || id.includes("@rc-component")) return "vendor-antd"
          if (id.includes("react-syntax-highlighter")) return "vendor-highlighter"
          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("unified") || id.includes("micromark") || id.includes("mdast")) return "vendor-markdown"
          if (id.includes("react-dom") || id.includes("scheduler")) return "vendor-react"
          if (id.includes("react") || id.includes("react-router")) return "vendor-react"
        },
      },
    },
  },
})
