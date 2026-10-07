# Optional: a local AI model for Vanessa ("Enhanced mode")

**You do not need this.** Standard Vanessa already answers schedule, evaluation, training, people, coverage, brief and data questions, remembers what you were talking about, and prepares changes for you to confirm. This setup only helps when someone words a request in a way she has no concept for. A future Co-Director can ignore this file completely.

What it is: a small AI model running **on a computer you control**, which Vanessa asks only when she isn't sure what a sentence means. It never sees your roster, schedule, evaluations or training records (only the sentence someone typed), it never answers for her (the answer always comes from the Hub's data), and it costs nothing to run. If it isn't running, Vanessa carries on in Standard mode without any error.

It is set up **per computer**, in that computer's browser, by an administrator. Co-Directors who want Enhanced mode on their own laptop do these steps once on that laptop.

---

## 1. What you need

- A recent **Chrome, Edge or Firefox** on a laptop or desktop. (Safari commonly blocks a secure web page from talking to a program on your own computer, so Enhanced mode may not work there; Standard still does.)
- About **4 GB of free memory and 3 GB of disk** for a small model. A GPU is not required; a normal laptop is fine, a little slower. Phones and tablets can't run this.
- A model runtime. The simplest is **Ollama** (free, open source, macOS / Windows / Linux).

## 2. Install Ollama and a model

1. Install Ollama from <https://ollama.com/download> and open it (it runs quietly in the background).
2. In a terminal, download a small model:

```bash
ollama pull llama3.2:3b
```

   That is the model the Hub suggests: good at picking an option from a list, which is all Vanessa asks of it. On an older or low-memory computer use the smaller one instead: `ollama pull llama3.2:1b`. (Any other small instruction-tuned model works; you choose it in step 4. Bigger models are slower and not needed.)

3. Check it answers:

```bash
ollama run llama3.2:3b "Reply with the word ready"
```

## 3. Let the Hub talk to it

A web page may only talk to Ollama if Ollama is told to allow that page. Allow the address your Hub is served from (for GitHub Pages that is `https://YOUR-NAME.github.io`; use exactly what you see before the first `/` in your browser's address bar).

**macOS** (Ollama app):

```bash
launchctl setenv OLLAMA_ORIGINS "https://YOUR-NAME.github.io"
```

then quit Ollama from its menu-bar icon and open it again.

**Windows:** search "Edit environment variables for your account", add a variable `OLLAMA_ORIGINS` with the value `https://YOUR-NAME.github.io`, then quit Ollama from the tray and start it again.

**Linux (systemd):** `sudo systemctl edit ollama`, add `Environment="OLLAMA_ORIGINS=https://YOUR-NAME.github.io"` under `[Service]`, then `sudo systemctl restart ollama`.

While you are testing the Hub from your own machine (`http://localhost:...`), allow that as well, separated by commas: `"https://YOUR-NAME.github.io,http://localhost:8125"`.

Chrome may show a one-time prompt such as "Look for and connect to any device on your local network" when the Hub first talks to Ollama: choose **Allow**.

## 4. Tell the Hub

1. Sign in as an administrator on that computer and open **Admin → Vanessa**.
2. Under **Local AI**, tick **Use a local AI model on this computer**.
3. Runtime: **Ollama**. Address: `http://localhost:11434` (already filled in).
4. Click **Check connection**; the **Model** box becomes a list of what you have installed. Choose `llama3.2:3b`.
5. Click **Save**, then **Test Vanessa Engine**.

You should see **"Local conversational engine connected successfully."** The header at the top of Admin → Vanessa will say Vanessa's mode is *Enhanced (local AI)*, and the panel's subtitle in her chat will say "enhanced with local AI". If you see **"…unavailable. Vanessa will continue using Standard Mode."** the line underneath says why; see the table below.

Other runtimes work the same way:

| Runtime | Choose | Address | Notes |
|---|---|---|---|
| **LM Studio** | "Local server with an OpenAI-style API" | `http://localhost:1234/v1` | Load a small model, start its local server, and turn on its **CORS** option |
| **llama.cpp** (`llama-server`) | the same | `http://localhost:8080/v1` | Start with a small GGUF instruct model; enable CORS if the browser reports a CORS error |
| **Inside the browser** | "Model inside this browser (WebGPU)" | — | Needs a recent Chrome/Edge with WebGPU. Click *Download and start the in-browser model* (a one-time download, then cached). Slower; nothing to install |

The address must be this computer or your own network (`localhost`, `192.168.x.x`, `10.x.x.x`, a `.local` name …). Vanessa **refuses any public or hosted AI address**, so the Hub's data can't be pointed at an outside AI service by accident. There is no key field because there is no key.

## 5. How it behaves once it's on

- Everyday requests ("Who still needs evaluated?", "When is my next tour?") are answered by Standard Vanessa instantly, **without** calling the model.
- Unusual wording is sent to the model, which replies with a structured request (which of her abilities, and what filter). Vanessa checks it against the person's role and the Hub's rules, then runs it with her normal tools. Names and dates are always taken from what the person typed, never from the model.
- Changes still show a confirmation card and still need a yes.
- If the model is slow (over about 12 seconds), stopped, or confused, that request is answered in Standard mode and Vanessa leaves the model alone for a minute. People just see her carry on.
- Optional: **Let the local model reword her answers**. Off by default. A rewording is discarded automatically if it changes any name, number or time.

You can set Vanessa to **Standard only** for everyone under *Admin → Vanessa → For everyone* at any time.

## 6. If it isn't connecting

| Message under *Health* | What it means | Fix |
|---|---|---|
| Offline — Couldn't reach the local model | Nothing answering at that address | Make sure Ollama is running (menu bar / tray icon). Open <http://localhost:11434> in a browser tab: it should say "Ollama is running" |
| Offline, but Ollama *is* running | The browser blocked the Hub's request | Step 3: set `OLLAMA_ORIGINS` to your Hub's address and restart Ollama. In Chrome, allow the local-network prompt. Don't use Safari |
| Offline, Ollama running, origins set | Some browsers add their own restriction on a hosted page reaching a local program | Try Edge or Firefox, or open the Hub from `http://localhost` on that computer (serve the folder with `python3 -m http.server`; see "Front-end tests" in `DEVELOPERS.md`) |
| Model not installed | Ollama is up but doesn't have that model | Run `ollama pull <the model name>` shown, or pick one from the list |
| No model chosen | Connected, but you haven't picked one | Choose a model, then Save |
| Address not allowed | You entered a public address | Use `http://localhost:11434` or a private network address |
| "The model took too long" | A big model on a small computer | Use `llama3.2:1b`, or close other heavy apps |
| Connected, but she sometimes ignores it | Working as designed | Clear requests don't need it; unusual ones use it. *This session* on the admin page shows how many it handled |

Nothing here can break the Hub or Standard Vanessa: the worst case is that she keeps using Standard mode.

## 7. Privacy and cost

- The model runs on the computer you set up. Nothing is sent to any outside AI company. The only thing it ever receives is the sentence a person typed (plus today's date and a list of what Vanessa can do for that person's role).
- There is no subscription, no per-use fee and no account. The model files are free to download once.
- Turning it off is one tick box; deleting it is `ollama rm llama3.2:3b`.
