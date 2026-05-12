# WEBLOO

A high-performance, full-stack search engine architecture built from scratch, implementing professional-grade retrieval algorithms, automated web crawling, and AI-powered synthesis.

## 🚀 "Big Tech" Level Features

This project was built to demonstrate core concepts required at companies like Google, Meta, and Amazon:

- **Proprietary Search Engine Core**: Built a custom indexing and ranking engine using the **BM25 (Best Matching 25)** probabilistic retrieval model.
- **Dynamic Web Crawler**: Implemented an asynchronous, depth-controlled crawler with `axios` and `cheerio`, featuring **Automated Discovery** and periodic **Re-indexing Maintenance**.
- **Gemini-Powered "Deep Search"**: Integrates LLMs to synthesize search results into high-level intelligence summaries, prioritizing authoritative sources.
- **Relational Feedback Loop**: A production-ready feedback system (Thumbs Up/Down) that logs relevance data to Firestore, enabling training data collection for future ranking adjustments.
- **Observability & Metrics**: Real-time admin monitor with sub-millisecond precision tracking for **Retrieval vs. Ranking** pipelines.
- **Security-First Design**: Implements RBAC (Role-Based Access Control) via Firebase Auth and hardened Firestore Security Rules.

---

## 🛠 Technical Architecture

### 1. The Retrieval Engine (`server.ts`)
The heart of the system is the `SearchEngine` class, which manages:
- **Inverted Indexing**: Maps stemmed tokens to document sets for O(1) retrieval.
- **TF-IDF / BM25 Ranking**: Calculates relevance scores based on term frequency, inverse document frequency, and document length normalization.
- **Porter Stemming**: Reduces words to their roots (e.g., "running" → "run") to increase recall.
- **Visual Indexing**: Context-aware image search that associates images with surrounding page text.

### 2. Crawler & Discovery
- **Self-Healing Web Discovery**: Automatically seeds the index with high-authority domains (Wikipedia, MDN) on startup.
- **Robots Awareness**: Basic logic to prevent crawling of restricted paths (`/admin`, `/login`).
- **Persistence**: Hybrid memory-first indexing with background persistence triggers.

### 3. Frontend & UX (`App.tsx`)
- **Real-Time Activity Monitor**: A specialized Admin Hub that shows live crawling statuses ("Indexing: example.com") and index health metrics.
- **Dark Mode Architecture**: Technical "Google-Dark" aesthetic (Hex: `#202124`) focused on readability and data density.
- **Interactive Analytics**: D3/Recharts visualizations showing term distribution and domain diversity across the index.

---

## 📊 Evaluation & Metrics
The system provides a "Search Intelligence" overlay that breaks down:
- **Σ Total Execution Time**: The end-to-end latency of the logic layer.
- **R Retrieval Time**: Time spent filtering the inverted index.
- **K Ranking Time**: Time spent calculating BM25 probabilities for the candidate set.

---

## 🛠 Tech Stack
- **Languages**: TypeScript (Full-stack)
- **Framework**: React 18 (Vite)
- **Styling**: Tailwind CSS + Framer Motion (Animations)
- **Backend**: Express (Node.js)
- **AI**: Gemini 3.1 Flash (Search Synthesis)
- **Database**: Firebase (Feedback, Auth, Rules)
- **Visualization**: Recharts

---

## 🔧 Getting Started

1. **Clone the project**
2. **Setup Dependencies**: `npm install`
3. **Environment Variables**:
   - `GEMINI_API_KEY`: For "Deep Search" synthesis.
   - `FIREBASE_CONFIG`: For the feedback loop.
4. **Launch**: `npm run dev`

---

*This project is part of a series focused on implementing fundamental computer science concepts (Information Retrieval, Distributed Crawling, and LLM Integration) at scale.*
