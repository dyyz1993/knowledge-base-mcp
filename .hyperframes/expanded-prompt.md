# HyperFrames Expanded Prompt

## Title + Style Block

**Video Title:** Knowledge Base MCP - 跨项目知识库服务

**Style:** Data Drift

**Palette (from design.md):**
- Primary: #0a0a0a (deep black background)
- On-primary: #e0e0e0 (light gray foreground)
- Accent-purple: #7c3aed (purple highlight)
- Accent-cyan: #06b6d4 (cyan highlight)

**Typography (from design.md):**
- Headline: Inter, 200 weight, 2.5rem (40px), letter-spacing 0.05em
- Body: Inter, 300 weight, 0.875rem (14px)

**Motion (from design.md):**
- Entry: sine.inOut, 1.0s
- Hold: 2.5s
- Transition: power2.out, 1.5s
- Ambient: sine.inOut

**Atmosphere:**
- Particle field background
- Light traces through frame
- Radial glow effects

---

## Rhythm Declaration

**Pattern:** hook-features-demo-CTA

**Total Duration:** ~25 seconds

**Energy Flow:**
- Scene 1: Slow-build (mysterious intro)
- Scene 2: Medium-impact (feature reveal)
- Scene 3: Medium-impact (search demonstration)
- Scene 4: High-impact (CTA with energy peak)

---

## Global Rules

**Parallax Layers:**
- Background: Particle field with slow drift
- Midground: Content cards and text
- Foreground: Accent lines and decorative elements

**Micro-Motion:**
- All decoratives have ambient breath/drift
- Text elements have subtle hover-like motion
- Particle field continuously floats

**Transition Style:**
- Primary: Gravitational Lens shader (design.md specified)
- Secondary: Velocity-matched blur crossfade for connective scenes

**Primary Transitions:**
- Scene 1→2: Gravitational Lens (hero reveal, 0.8s, power2.inOut)
- Scene 3→4: Gravitational Lens (CTA reveal, 0.8s, power2.inOut)

**Secondary Transitions:**
- Scene 2→3: Velocity-matched blur crossfade (0.5s)

**Energy:**
- Moderate baseline with strategic peaks
- Eases: sine.inOut for ambient, power2.out for entries

---

## Per-Scene Beats

### Scene 1: Hook - "你的知识，需要一个家" (0-6s)

**Concept:**
Camera is already drifting through a dark cosmic space filled with floating data particles. These particles aren't random — they're fragments of knowledge, code snippets, project docs. The scene feels like looking into a neural network made of your collective project wisdom. The viewer should feel curiosity and anticipation.

**Mood Direction:**
Futuristic, immersive. Think AI data visualization meets cosmic nebula. Deep blacks with purple and cyan accents. The feeling is "this is where knowledge lives."

**Depth Layers:**
- BG: Deep black (#0a0a0a) + radial purple glow (12% opacity) + particle field (100+ dots, slow drift)
- MG: Large ghost text "KNOWLEDGE" at 5% opacity, 150px, extremely thin weight
- FG: Main title card + 2 accent lines + 3 floating data fragments

**Animation Choreography:**
- "Knowledge Base MCP" FLOATS up from opacity 0 at y: 30, sine.inOut, 1.0s
- "跨项目知识库服务" TYPES IN letter-by-letter, sine.inOut, 0.8s delay 0.3s
- 2 accent lines (vertical, left and right edges) SCALE up from 0 to 1, power2.out, 0.6s
- 3 data fragments (code snippets in monospace) DRIFT in from random angles, staggered 0.2s
- Particle field CONTINUOUSLY floats, no sudden moves

**Transition Out:**
Gravitational Lens shader, 0.8s, power2.inOut — the space warps and folds into the next scene like light passing through a gravitational field.

---

### Scene 2: Features - "三层搜索，一触即达" (6-14s)

**Concept:**
We're inside the knowledge engine now. Three vertical pillars rise up, each representing a search layer — Text Match, TF-IDF, Semantic Vector. They pulse with energy as text flows through them. This isn't a diagram — it's a visual representation of how information flows through the system. The viewer should feel the power and precision of the search architecture.

**Mood Direction:**
Data-driven, architectural. Think blueprint meets hologram. The pillars feel structural yet ethereal — built of light and data. Purple glow emanates from the semantic layer (the most powerful one).

**Depth Layers:**
- BG: Deep black + cyan radial glow (bottom center) + grid pattern overlay (8% opacity)
- MG: 3 vertical pillars (data visualization style) + connecting flow lines
- FG: "Text Match" / "TF-IDF" / "Semantic" labels + 2 floating stat bubbles

**Animation Choreography:**
- Pillar 1 (Text Match) RISES from bottom, scale 0→1, sine.inOut, 0.7s, t=0.3s
- Pillar 2 (TF-IDF) RISES, staggered 0.2s, sine.inOut, 0.7s
- Pillar 3 (Semantic) RISES, staggered 0.2s, sine.inOut, 0.7s — PULSE with purple glow at finish
- Flow lines CASCADE down between pillars, staggered 0.1s per line
- Labels SLIDE in from left, power2.out, 0.5s, t=1.0s
- Stat bubbles ("0.2s" / "0.3s" / "0.5s") POP in, back.out(1.5), 0.4s each
- All elements have subtle ambient breath (opacity 0.8→1.0 cycle)

**Transition Out:**
Velocity-matched blur crossfade. Exit: y: -100, blur: 20px, 0.5s, power2.in. Entry (scene 3): y: 100→0, blur: 20px→0, 0.5s, power2.out. The camera feels like it's tracking upward through the pillars into the search results.

---

### Scene 3: Demo - "自然语言，精准检索" (14-20s)

**Concept:**
A search bar materializes in the center. We watch as it types "React Hooks best practices" — then see the search results cascade down from above. The results are visual cards with tags, scores, and snippets. One card glows with cyan — the best match. The viewer experiences the semantic search in real-time.

**Mood Direction:**
Clean, functional, precise. Think modern SaaS dashboard meets AI search interface. The focus is on the interaction — the typing, the results appearing, the match highlighting.

**Depth Layers:**
- BG: Deep black + subtle radial purple glow (center) + horizontal scan lines (5% opacity)
- MG: Search bar + 3 result cards
- FG: Search prompt text + match score badges + 2 accent dots

**Animation Choreography:**
- Search bar DROPS from y: -50, scale 1.1→1, power2.out, 0.6s, t=0.3s
- "React Hooks best practices" TYPES IN, sine.inOut, 1.2s, t=0.6s
- Card 1 CASCADES from y: -30, opacity 0→1, power2.out, 0.5s, t=2.0s
- Card 2 CASCADES, staggered 0.15s
- Card 3 CASCADES, staggered 0.15s — this one GLOWS with cyan border (best match)
- Match score badges POP in, back.out(1.3), 0.3s each, t=2.5s
- Search prompt "搜索中..." FADES in, sine.inOut, 0.4s, t=1.0s, then FADES out
- Scan lines continuously drift upward

**Transition Out:**
Gravitational Lens shader, 0.8s, power2.inOut — the search interface warps and pulls everything toward center, revealing the CTA.

---

### Scene 4: CTA - "开始使用" (20-25s)

**Concept:**
A single command fills the frame: `npx @dyyz1993/kb-mcp --stdio`. It's surrounded by a halo of purple and cyan light. Below, the tagline "让你的知识流动起来" appears. The scene radiates energy — this is the moment of action. The viewer should feel compelled to try it.

**Mood Direction:**
Energizing, call-to-action. Think terminal meets magical interface. The command is the hero — bold, clear, surrounded by light. It's not just a command line — it's the key to unlocking knowledge.

**Depth Layers:**
- BG: Deep black + purple + cyan radial glows (overlapping, 20% opacity)
- MG: Command block + tagline + GitHub link
- FG: 4 accent sparkles + 2 orbit rings (thin, breathing)

**Animation Choreography:**
- Command block `npx @dyyz1993/kb-mcp --stdio` SLAMS in from y: 40, scale 1.2→1, back.out(2), 0.7s, t=0.3s
- Purple glow EXPANDS from center, scale 0.8→1.2, sine.inOut, 1.0s, t=0.3s
- Cyan glow EXPANDS, scale 0.9→1.1, sine.inOut, 1.0s, t=0.4s (staggered)
- Tagline FLOATS up from y: 30, opacity 0→1, sine.inOut, 0.8s, t=1.0s
- GitHub link FADES in, sine.inOut, 0.6s, t=1.5s
- 4 sparkles POP in randomly, back.out(2), 0.4s each
- 2 orbit rings CONTINUOUSLY rotate at different speeds

**Transition Out:**
Fade to black on final scene only. All elements FADE to opacity 0, power1.in, 1.0s. No further scenes follow.

---

## Recurring Motifs

**Visual Threads:**
- Purple (#7c3aed) and cyan (#06b6d4) accents appear in every scene
- Deep black (#0a0a0a) is the consistent background
- Particle field / data fragments appear in scenes 1 and 2 as connecting texture
- Ghost text appears in scene 1 and subtly in scene 2 as background texture
- Thin accent lines (hairline rules) frame content in scenes 2, 3, 4

**Color Usage:**
- Purple: Semantic search, intelligence, AI capability
- Cyan: Search results, matches, precision
- Black: The canvas, the void from which knowledge emerges

---

## Negative Prompt

**Avoid:**
- Any color outside the palette (no blue, green, orange, etc. — unless they're from the brand palette)
- Jump cuts between scenes (every transition is handled by shaders or velocity-matched crossfade)
- Static decoratives (everything needs ambient motion)
- Centered-only layouts (anchor to edges, use split frames)
- Text under 24px (this is video, not web)
- Decorative opacity under 12% (will be invisible)
- Identical entrance animations (vary directions, eases, timing)
- Gradient text (lazy default — use solid colors with glow)
- Pure #000 or #fff backgrounds (tint toward accent hue)
- Exit animations before transitions (transition IS the exit)

**Design.md Constraints:**
- Use Inter font only
- Thin weights (200-300) for all type
- No aggressive animations (energy is "moderate")
- Sine.inOut and power2 eases dominate
- Organic, fluid motion — nothing snaps or crashes

---

## Technical Notes

**Total Scenes:** 4
**Total Duration:** ~25 seconds
**Video Ratio:** 9:16 (vertical, optimized for TikTok/小红书)
**Resolution:** 1080x1920

**Fonts Used:**
- Inter (built-in, embedded by compiler)

**Colors:**
All from Data Drift palette in design.md.

**Motion:**
Follows sine.inOut → power2.out → power2.in pattern for entries → holds → exits.

**Transitions:**
- 2 Gravitational Lens shader transitions (scenes 1→2, 3→4)
- 1 Velocity-matched blur crossfade (scene 2→3)
- 1 Final fade to black (end of scene 4)
