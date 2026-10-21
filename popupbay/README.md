# PopupBay Studio

Reads a client brief (Excel, Word or PDF), fills in the client details, builds a 3D exhibition booth on the Expo Prestige modular system, and lets you change the design by chatting.

## Run it

You need **Node.js 18 or newer** (check with `node -v`). There is nothing to install with npm.

```bash
cd popupbay
npm start
```

Open **http://localhost:6440** in Chrome or Edge.

Keep an internet connection on: the page loads three.js, SheetJS, mammoth and pdf.js from public CDNs.

## Turn on the AI chat (optional)

The chat works without AI for direct commands such as:

- `add a podium` / `remove the TV` / `3 tables`
- `make it 6 x 4` / `3 sides open` / `island`
- `store on the right` / `store 2 x 1.5`
- `premium dark` / `clean white` / `bold` / `blue carpet` / `red accent`
- `headline: Powering smarter homes` / `brand name: HAVELLS`
- `curved end caps` / `flat end caps`
- `move the brochure stand to the left` / `put the TV on the right` / `shift the reception to the back right` / `tables to the front` (front, back, left, right, center, or a corner such as `front left`)
- `make the carpet blue` / `red walls` / `gold accent` / `white chairs`
- `left corner view` / `right corner view` / `top view` / `front view` / `show the top plan` / `undo`

To ask in your own words (for example “make it feel more luxurious and add space for a product launch”), create a file named `.env` next to `server.js`:

```
ANTHROPIC_API_KEY=sk-ant-...
# optional
ANTHROPIC_MODEL=claude-sonnet-5-5
PORT=6440
```

Then restart with `npm start`. The terminal shows `AI chat: ON` when the key is picked up. The key stays on your machine; the browser never sees it.


## Design chat: local and live

The chat runs through `server.js`, so the API key stays on the server and is never sent to the browser. The same code works on your computer and on a live site.

**Locally:** copy `.env.example` to `.env`, put your key in it, run `npm start`. The terminal shows `AI chat: ON`.

**Live:** deploy this folder as a Node app (any host that runs Node 18+ or Docker: Render, Railway, Fly.io, a VPS) and set these environment variables in the host's settings instead of a `.env` file:

- `ANTHROPIC_API_KEY` (required for free-wording chat)
- `PORT` (most hosts set it for you), optional `ANTHROPIC_MODEL`, optional `CHAT_LIMIT_PER_MIN` (default 30 requests per visitor per minute)

The start command is `npm start` (or use the included `Dockerfile`). The server listens on `0.0.0.0`, retries when the AI is busy, limits each visitor, and falls back to the built-in direct commands if the AI cannot be reached, so the chat never just stops. Open `/api/health` on your site: `"ai": true` means the AI chat is on.

## Wall structure

The walls follow the Expo Prestige pop-up system used in the reference stands (Hamdard 3×3, DentCare 3×3 / 6×3 / 6×6):

- **Pop-up X-truss frame**, 2367 mm high and 300 mm deep, one X bay per 780 mm module. The top is open, so the white scissor truss and hubs show from above, as in the top views.
- **Seamless graphics** on the inside and outside faces, made of 780 × 789 mm magnetic panels (3 rows per frame). The joints show faintly. There is no separate fascia: the logo sits at the top of the back wall.
- **End caps** on every free wall end. They can be **curved** (half-round, brand colour, like Hamdard) or **flat** (colour return like DentCare, brand colour on the left and accent on the right). Both carry the website, reading bottom to top. Switch them under **Look → End caps** or say “flat end caps” in the chat.
- **Rounded 90° corners** where the back wall meets a side wall.
- **Window showcases are built into the wall**: a 740 × 990 mm opening (from 750 to 1740 mm above the floor) recessed into the 300 mm wall depth. It has an acrylic front flush with the graphic, an aluminium trim, two glass shelves and two LED spots. The graphic continues around the opening, and the top plan draws the showcase inside the wall.
- **Arm spotlights** clamped to the top of the frame, washing the graphics.
- An island stand gets a free-standing double-sided pop-up wall with curved caps on both ends.

**Camera views:** Left corner, Front, Right corner, Top and Spin buttons under the 3D view.

The top plan draws the same structure: wall depth, X bays, end caps and rounded corners. It also shows:

- **Frame sizes**: every frame is tagged 3×1, 3×2, 3×3 or 3×4, and the legend counts each size used.
- **Lights**: one light in every X-cross of every frame.
- **Straight connector** (190 / 445 / 780 mm): one orange connector between two structures, sized from the floor space. Set sizes: 5×3 m 445 mm (with or without store room), 6×3 m 445 mm, 5×4 m 190 mm. There is no fixed default: for every other floor the layout is checked each time and the connector (190 / 445 / 780 mm) that leaves the frames closest to whole 780 mm modules is used. Edit `CONNECTOR_TABLE` in `index.html` to add more.
- **Store room**: built from the same 300 mm X-truss frames, with its own tags and lights, and rounded (D-shape) or flat (one strong line) end caps on its free ends.

## Reception counters and podiums

Taken from the Insta "Reception Counter / Product Counters" catalogue (included as `Reception_Counter__Product_Counters.pdf`). Sizes are W × H × D in mm.

| Item | Type | Size | 3D model |
|---|---|---|---|
| Reception counter | **Rapid Counter** | 800 × 990 × 533 | grey carcass, graphic front, overhanging white top |
| Reception counter | **Butterfly Counter** | 943 × 931 × 528 | V-shaped graphic front, aluminium frame, open back with shelf |
| Podium | **Round Counter** | 500 × 880 × 500 | waisted fabric drum, pole and round graphic sign |
| Podium | **Hype Podium Medium** | 500 × 650 × 500 | fabric box with curved sides |
| Podium | **Hype Podium Large** | 500 × 930 × 500 | fabric box with curved sides |
| Podium | **Eurofold Counter** | 1210 × 740 × 610 | folding table with a curved fabric cover |

The brief fields **Reception counter** and **Product display prodium** are read for the type and the number of each, for example "Hype Podium Medium - 2 Nos. and Large Podium - 1 Nos." gives two medium and one large. You can change the type under **Elements** or in the chat ("butterfly counter", "hype podium large", "round counter", "eurofold").

The top plan draws each one in its own shape (counter outlines, round, curved-side square, curved-front table), tags each podium (RD = Round, HM = Hype Medium, HL = Hype Large, EF = Eurofold) and lists the type, size and catalogue code in the legend under the plan.

## Brand from the client website

Type or paste the client's website in the **Website** field (or press **Scan**). The local server opens the site and finds:

- **the logo**: the header logo image or inline SVG, with the site icon as a fallback. A white background is removed and the empty margins are trimmed.
- **the brand colours**: from the logo itself, the site's `theme-color`, and CSS variables such as `--primary` / `--brand`. Common framework colours (Bootstrap blue and so on) count for less.

The booth updates straight away: logo on the fascia, reception counter, TV and brochures, plus brand and accent colours on the walls. Swatches appear under the Website field. Click one to make it the brand colour, or shift-click to make it the accent.

Briefs that already have a website (all 5 sample clients do) are scanned automatically when you open the client.

Some sites block automated visits and answer with an error such as `HTTP 403`. When that happens, add the logo by hand under **Look → Add logo** and pick the colours yourself.

## Generate design options

The summary card at the top of the left panel shows how complete the brief is, a mini top plan, the key needs and any heads-up. **Generate design options** renders 6 concepts that keep the same brief (size, open sides, all items) but change the look:

| Concept | What changes |
|---|---|
| Signature | Brand gradient walls, warm light |
| Gallery White | White walls, brand-colour chairs, light carpet, cool light |
| Midnight Premium | Dark walls, gold accent, showtime lighting, dark carpet |
| Bold Block | Solid brand colour with a contrasting accent |
| Mirror Plan | Walls and store room flipped to the other side, extra plants |
| Second Colour / Tonal | The website's second colour leads, or a deeper brand tone |

**Generate more** gives a new round (different headlines, carpets, chair colours, lighting). **Use this design** applies one, and Undo takes it back. With an API key set, Claude writes the concepts instead of the fixed list. You can also type "give me different designs" in the chat.

## What's inside

```
popupbay/                 everything in one folder
├── index.html                the whole app (UI, brief reader, 3D builder, top plan, chat)
├── server.js                 local web server + optional Claude chat proxy
├── package.json              "npm start"
├── Brief_Templates_2.xlsx    sample client briefs (drag onto the page to test)
├── Expo_Prestige_Notes.docx  the modular system rules the 3D builder follows
├── Reception_Counter__Product_Counters.pdf  counter and podium catalogue the 3D models follow
└── .env                      (you create this, optional) your API key
```

In `index.html`:

| Section | What it does |
|---|---|
| Expo Prestige constants | 780 mm module, 2367 mm structure height, 300 mm pop-up wall depth, 780 × 789 mm graphic panels, 42″ TV |
| Brief parsing | Label matching for Excel, Word tables and paragraphs, PDF text lines. Handles the brief's spellings ("prodium", "showcse", "strore", "charis") |
| `briefToConfig` | Turns brief answers into design values: size, open sides, counts, store size, carpet colour. Flags contradictions (e.g. Monotech: “3 side open” vs “One Side open”) |
| `planLayout` | Places the pop-up walls (with their free ends and rounded corners), store room, showcases and TVs on the walls, then reception, tables, podiums, brochure stand and plants on the floor without overlaps |
| `structureSchedule` | Pop-up frames (3×1 to 3×4), straight connectors, feet, 780×789 graphic panels, curved corners, curved/flat end caps |
| `buildBooth` | three.js model: pop-up X-truss walls with seamless graphics, open truss top, curved or flat colour end caps, rounded corners, arm spotlights, curtain store, counter, podiums, showcases, TV slideshow, tables and chairs |
| Brand scan | `fetchBrand` (page) + `/api/brand` (server.js): logo and colours from the website |
| Design options | `makeVariants`, `aiVariants`, `openOptions`, `renderThumb`: concepts and preview renders |
| `planSVG` | Dimensioned top plan (mm), exportable as SVG |
| Chat | AI via `/api/chat` when a key is set, otherwise the built-in command reader. Undo keeps every step |

## Using it

1. The 5 briefs from `Brief_Templates_2.xlsx` are preloaded as tabs at the top.
2. Drop another brief on the page, or press **Upload brief**. A workbook with several sheets gives one tab per client.
3. Fields with a blue dot were read from the brief. Edit any field and the booth rebuilds.
4. **Add logo** puts your logo image on the fascia, counter, brochures and screen.
5. **Top plan** shows the dimensioned layout. **Export** saves a PNG render, the plan as SVG, or the full design as JSON.

Brand colours are guesses from the client name; set exact values in **Look → Brand colours**.

## Light & corner connector rules
- One light per X-cross. If a store room exists, the single cross next to the rounded corner connector in front of the store (one on the back wall, one on the side wall) gets no light. Works for a store at either corner.
- Corner connectors in the top plan: 90° outside (curved band, L/U corners), 90° inside (concave fillet where the store wall meets the back wall), 45° outside (pick "45° outside (angled)" under Corner connectors: diagonal frame + two 45° connectors). A store's own corner stays 90°.


## Add, move, remove anything from the chat (works offline, no API key)

- **Add anything:** "add a sofa", "add a LED wall on the back 3 x 0.2 m blue", "add 2 stools near the front right", "add a bar counter 1.5 x 0.6 m dark green at the front left", "add a banner on the right", "add a cabinet on the left".
  Known items get sensible default sizes (sofa, LED wall, bar, cabinet, banner, stool, pillar, stage, bench...). Anything else becomes a 0.8 x 0.8 x 0.9 m block you can resize.
- **Move:** "move the sofa to the left", "put the LED wall at the back right", "move the sofa to the other side", "swap sides of reception and brochure".
- **Recolour / resize:** "make the sofa red", "make the bar counter orange", "make the sofa bigger", "make the LED wall 3 m wide".
- **Remove:** "remove the sofa", "remove the stools", "remove all extras".
- Extra items also appear as chips under *Extra items* in the form (click x to remove). If the floor is full, the chat says which item does not fit.
- Items you give a position (left, back, front right...) are placed first; the standard items (tables, podiums...) move around them.


## Make the chat create anything (free options)

The built-in chat works offline for add / move / remove / recolour / resize. To let it **invent** things from your words
("build a golden entrance arch", "a round bar table with 3 stools", "a stage with steps", "a tree"), connect any ONE AI provider.
Put a line in `.env` (same folder as `server.js`) and restart with `npm start`; the terminal then says `AI chat: ON`.

| Provider | Cost | `.env` line |
|---|---|---|
| Google Gemini (AI Studio) | free tier | `GEMINI_API_KEY=...` |
| Groq | free tier | `GROQ_API_KEY=...` |
| OpenRouter | free ":free" models | `OPENROUTER_API_KEY=...` |
| Ollama (runs on your PC) | free, offline | `LLM_PROVIDER=ollama` |
| Claude / OpenAI | paid | `ANTHROPIC_API_KEY=...` / `OPENAI_API_KEY=...` |

Model names change; if a provider reports an unknown model set `LLM_MODEL=` to a current one. On a live host set the same values as environment variables.
The AI builds new items from simple shapes (box, cylinder, sphere, cone), so results are clean 3D mock-ups, not detailed models.
Free tiers have daily limits and the quality of smaller free models varies; if a request fails the chat falls back to offline mode automatically.


## Create a design from the client brief (LLM + RAG)

Press **Create my own design from this brief** (left panel) or type "create a design for me" in the chat.

1. **Retrieve (RAG).** The server searches two sources with BM25 keyword ranking (no extra software needed):
   - `knowledge/` : the Expo Prestige technical notes, the product-counter sheet and `design_rules.txt` (layout, connector, lighting and style rules). Add your own `.txt` or `.md` files here and they are used automatically.
   - `data/designs/` : past designs. The 5 bundled ones are samples made from the sample briefs; the real value comes from pressing **Save this design as a reference** on finished stands you like.
2. **Generate (LLM).** The brief, the retrieved rules and the 3 most similar past designs go to the AI provider. It returns a new concept: styles, colours, where things go, and signature 3D elements (arch, LED wall, bar...). The app checks the answer and applies it; **Undo** reverts it.
3. **Past designs on or off.** Untick **Learn from past designs** to design from the brief and the rules alone.
4. **No AI key?** It still works offline: it adapts the nearest past design to this client's brand colours, or (with no past designs) picks a style from the stand size and the client's field. The AI makes it original.

Saved designs are plain JSON files in `data/designs/`. When hosted, point `DATA_DIR` at a persistent disk or they are lost on redeploy.
This is keyword retrieval (BM25), not embeddings: it matches on client, industry words, size and open sides. It can be upgraded to embeddings later.


## Chat commands (trained for every client)

The chat works the same on every client design. It reads what the current design has (and does not have) before it acts.

- **Independent objects.** Every floor object keeps its own position: reception counter, brochure stand, each podium by its tag (EF1, RD1, HM1, HL1) and each meeting table (T1, T2). Moving one never moves another. Objects move together only if you say "all" or "both".
- **Position words.** "Move the reception counter to the ..." extreme right, extreme left, back-right corner, back-left corner, front-right corner, front-left corner, middle-right, middle-left, centre, back centre, front centre. Objects stay inside the stand and never overlap another object or the store room.
- **Questions instead of guesses.** "Right corner" asks back or front. "Move the podium" asks which one when there are several (reply with the tag, a number or "all"). A new command replaces an open question.
- **Honest answers.** If the spot is taken, the chat names the object in the way and leaves the object where it is, or places it as close as it can and says so. Nothing else moves.
- **Only what the design has.** On a stand without a shelf display, TV, table, podium or brochure stand, "move the shelf display" says so and changes nothing. It never invents an element. "Add a shelf display" adds a window showcase.
- **Shelf displays.** Moving or arranging them keeps them together as one tidy group (100 mm apart). "Arrange the shelf displays together" groups them where they are. The TV and the shelf displays move independently of each other.
- **Everything else is unchanged.** Default layouts, colours, 3D and the top plan are exactly as before; this only changes how chat commands are understood and applied. The AI chat (when a key is set) is given the same rules and the list of what the design has.

## Collision-aware edits ("make room")
When a move lands on an occupied spot, the chat moves only the objects in the way to their nearest valid spots (same row preferred, never into the store room or custom items), cascades if that spot is taken, and applies the result only after the layout engine confirms every object ends exactly where intended. If the stand is too crowded it says so and changes nothing. An "add" that does not fit re-spaces the floor objects. Fixed catalogue sizes (reception, podiums, tables) cannot be stretched; items you add yourself can be resized.

## Elevation view
A third view next to 3D and Top plan: front elevation looking from the aisle (walls with frame joints and connectors, lights, feet, TV, window showcases, reception, podiums, tables, brochure stand, plants, extra items), with overall width and height dimensions and the title bar. Export → "Elevation (SVG)", or ask the chat for "show the elevation". The top-left floor-usage percentage was removed; the bar now just says whether everything fits.

## Signature styles (fixed kit, many looks)
"Signature styles" (button, or chat: "show design options") offers 8 curated concepts built only from the fixed Expo Prestige kit (frames, lights, connectors, catalogue counters). Each changes graphics, light, colours, end caps/corners AND where the existing objects stand (showroom, gallery line, lounge corner, podium cluster, arc, corner hub). Nothing is added or removed from the brief. Every arrangement is checked against the layout engine (no overlaps, nothing dropped); if a stand is too tight the look is applied and the current arrangement is kept.

## Website scanning (logo + colours) on your live site
Browsers cannot read another website's pages, so the logo and colour scan runs in the **Node server** (`/api/brand`), not in the page. It works wherever the server runs:

1. **Host the whole app** (page + server together) on any Node host (Render, Railway, Fly.io, a VPS, or the included `Dockerfile`). Same address for page and API, so nothing else to set. Set `PORT` if the host asks.
2. **Page hosted separately** (static host, WordPress, your existing site): host `server.js` somewhere (step 1), then either
   - open the page with `?api=https://your-server-address`, or
   - add `<script>window.POPUPBAY_API = 'https://your-server-address'</script>` before the app script, or
   - type `connect server https://your-server-address` in the chat (remembered in that browser).
   Set `ALLOW_ORIGIN=https://your-live-site.com` on the server so only your site can call it (default `*`).
3. Put `ANTHROPIC_API_KEY` etc. in the host's environment variables (never in the page) to switch on the AI chat.

The scanner only fetches public websites (private and internal addresses are refused) and follows at most 5 redirects.
