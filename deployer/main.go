package main

import (
	"bufio"
	"fmt"
	"text/template"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// State — one deploy at a time, SSE broadcast to all connected clients
// ---------------------------------------------------------------------------

type deployer struct {
	mu      sync.Mutex
	running bool
	lines   []string
	clients map[chan string]struct{}
}

var state = &deployer{
	clients: make(map[chan string]struct{}),
}

func (d *deployer) broadcast(line string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.lines = append(d.lines, line)
	for ch := range d.clients {
		select {
		case ch <- line:
		default:
		}
	}
}

func (d *deployer) subscribe() chan string {
	ch := make(chan string, 128)
	d.mu.Lock()
	d.clients[ch] = struct{}{}
	d.mu.Unlock()
	return ch
}

func (d *deployer) unsubscribe(ch chan string) {
	d.mu.Lock()
	delete(d.clients, ch)
	d.mu.Unlock()
}

func (d *deployer) snapshot() ([]string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	cp := make([]string, len(d.lines))
	copy(cp, d.lines)
	return cp, d.running
}

// ---------------------------------------------------------------------------
// Deploy execution
// ---------------------------------------------------------------------------

const deployScript = "/project/autodeploy.sh"

func (d *deployer) run() {
	d.mu.Lock()
	if d.running {
		d.mu.Unlock()
		return
	}
	d.running = true
	d.lines = nil
	d.mu.Unlock()

	go func() {
		defer func() {
			d.mu.Lock()
			d.running = false
			d.mu.Unlock()
			d.broadcast("__DONE__")
		}()

		d.broadcast(fmt.Sprintf("=== Deploy started at %s ===", time.Now().Format("2006-01-02 15:04:05")))

		cmd := exec.Command("/bin/bash", deployScript)
		cmd.Dir = "/project"

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			d.broadcast("ERROR: " + err.Error())
			return
		}
		cmd.Stderr = cmd.Stdout // merge stderr into stdout

		if err := cmd.Start(); err != nil {
			d.broadcast("ERROR: " + err.Error())
			return
		}

		scanner := bufio.NewScanner(io.LimitReader(stdout, 10<<20))
		for scanner.Scan() {
			d.broadcast(scanner.Text())
		}

		if err := cmd.Wait(); err != nil {
			d.broadcast("=== Deploy failed: " + err.Error() + " ===")
		} else {
			d.broadcast("=== Deploy complete ===")
		}
	}()
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

var deployToken string

func auth(r *http.Request) bool {
	if deployToken == "" {
		return true
	}
	return r.URL.Query().Get("token") == deployToken
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// GET /?token=XXX — serve page; page auto-triggers deploy on load
func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if !auth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := pageTmpl.Execute(w, nil); err != nil {
		log.Println("template error:", err)
	}
}

// POST /run?token=XXX — trigger deploy
func handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !auth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	state.run()
	w.WriteHeader(http.StatusAccepted)
}

// GET /stream?token=XXX — SSE stream
func handleStream(w http.ResponseWriter, r *http.Request) {
	if !auth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Replay past lines first
	past, running := state.snapshot()
	for _, line := range past {
		fmt.Fprintf(w, "data: %s\n\n", line)
	}
	if !running && len(past) > 0 {
		fmt.Fprintf(w, "data: __DONE__\n\n")
		flusher.Flush()
		return
	}
	flusher.Flush()

	ch := state.subscribe()
	defer state.unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
			if line == "__DONE__" {
				return
			}
		case <-time.After(25 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	deployToken = os.Getenv("DEPLOY_TOKEN")
	port := os.Getenv("DEPLOYER_PORT")
	if port == "" {
		port = "9090"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleIndex)
	mux.HandleFunc("/run", handleRun)
	mux.HandleFunc("/stream", handleStream)

	srv := &http.Server{
		Addr:        "127.0.0.1:" + port,
		Handler:     mux,
		ReadTimeout: 10 * time.Second,
	}

	log.Printf("deployer listening on 127.0.0.1:%s", port)
	if deployToken == "" {
		log.Println("WARNING: DEPLOY_TOKEN not set — endpoint is open")
	}

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// Embedded HTML — token passed in as template data (string)
// ---------------------------------------------------------------------------

var pageTmpl = template.Must(template.New("page").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Deploy</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #070b14;
    color: #e2e8f0;
    font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 1.5rem;
    gap: 1rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }
  h1 { font-size: 1rem; font-weight: 600; color: #fff; letter-spacing: .05em; }
  #status-badge {
    font-size: .75rem;
    padding: .2rem .75rem;
    border-radius: 9999px;
    background: #1e2a3d;
    color: #94a3b8;
    border: 1px solid #1e2a3d;
  }
  #status-badge.running { background: #14532d40; color: #4ade80; border-color: #166534; }
  #status-badge.done    { background: #14532d40; color: #4ade80; border-color: #166534; }
  #status-badge.failed  { background: #450a0a40; color: #f87171; border-color: #7f1d1d; }
  button {
    padding: .4rem 1rem;
    border-radius: .4rem;
    border: 1px solid #1e2a3d;
    background: #1a2332;
    color: #94a3b8;
    font-family: inherit;
    font-size: .8rem;
    cursor: pointer;
    transition: background .15s;
  }
  button:hover:not(:disabled) { background: #1e2a3d; color: #e2e8f0; }
  button#redeploy-btn {
    background: #1e3a8a;
    border-color: #1e40af;
    color: #93c5fd;
    font-weight: 600;
  }
  button#redeploy-btn:hover:not(:disabled) { background: #1e40af; color: #fff; }
  button:disabled { opacity: .4; cursor: not-allowed; }
  #terminal {
    flex: 1;
    overflow-y: auto;
    background: #0d1117;
    border: 1px solid #1e2a3d;
    border-radius: .6rem;
    padding: 1rem 1.2rem;
    font-size: .78rem;
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .line-done   { color: #4ade80; }
  .line-err    { color: #f87171; }
  .line-header { color: #60a5fa; }
  .line-normal { color: #cbd5e1; }
  .cursor {
    display: inline-block;
    width: .5em;
    height: 1em;
    background: #60a5fa;
    animation: blink .9s step-end infinite;
    vertical-align: text-bottom;
  }
  @keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<header>
  <h1>⚡ Deploy</h1>
  <span id="status-badge">starting…</span>
  <div style="flex:1"></div>
  <button id="redeploy-btn" disabled>↺ Re-deploy</button>
</header>
<div id="terminal"><span class="cursor"></span></div>

<script>
(function() {
  const TOKEN = new URLSearchParams(window.location.search).get('token') || '';
  const terminal  = document.getElementById('terminal');
  const badge     = document.getElementById('status-badge');
  const redeployBtn = document.getElementById('redeploy-btn');

  let cursor = terminal.querySelector('.cursor');
  let es = null;

  function qs(p) { return p + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : ''); }

  function setStatus(s) {
    badge.textContent = s;
    badge.className   = s === 'RUNNING' ? 'running' : s === 'DONE' ? 'done' : s === 'FAILED' ? 'failed' : '';
    redeployBtn.disabled = (s === 'RUNNING' || s === 'starting…');
  }

  function appendLine(text) {
    if (cursor) { cursor.remove(); cursor = null; }
    if (text === '__DONE__') return; // handled by onDone
    const div = document.createElement('div');
    if (text.startsWith('===')) {
      div.className = text.includes('failed') ? 'line-err' : text.includes('complete') ? 'line-done' : 'line-header';
    } else if (/\b(error|fatal|fail)\b/i.test(text)) {
      div.className = 'line-err';
    } else {
      div.className = 'line-normal';
    }
    div.textContent = text;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function onDone(failed) {
    if (es) { es.close(); es = null; }
    setStatus(failed ? 'FAILED' : 'DONE');
  }

  function startStream() {
    if (es) { es.close(); es = null; }
    es = new EventSource(qs('stream'));
    es.onmessage = e => {
      if (e.data === '__DONE__') {
        // Determine success/failure from last line text
        const lines = terminal.querySelectorAll('.line-err');
        onDone(lines.length > 0 && terminal.lastElementChild && terminal.lastElementChild.classList.contains('line-err'));
        return;
      }
      appendLine(e.data);
    };
    es.onerror = () => onDone(true);
  }

  async function triggerAndStream() {
    setStatus('RUNNING');
    try {
      const res = await fetch(qs('run'), { method: 'POST' });
      if (!res.ok) {
        appendLine('ERROR: ' + res.status + ' ' + res.statusText);
        onDone(true);
        return;
      }
    } catch(e) {
      appendLine('ERROR: ' + e.message);
      onDone(true);
      return;
    }
    startStream();
  }

  redeployBtn.addEventListener('click', () => {
    terminal.innerHTML = '';
    triggerAndStream();
  });

  // Auto-start on page load
  triggerAndStream();
})();
</script>
</body>
</html>
`))
