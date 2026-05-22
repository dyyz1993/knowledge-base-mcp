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
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-antd": ["antd"],
          "vendor-markdown": [
            "react-markdown",
            "remark-gfm",
            "react-syntax-highlighter",
          ],
          "vendor-mermaid": ["mermaid"],
          "vendor-cytoscape": ["cytoscape"],
          "vendor-katex": ["katex"],
        },
      },
    },
  },
})
