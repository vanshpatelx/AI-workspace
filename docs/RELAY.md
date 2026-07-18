# Optional Relay

The relay lets a Desktop reach a Worker when they cannot connect directly —
no VPN, no port forwarding. It is **optional**: with Tailscale, WireGuard, a
local network or an SSH tunnel you never need it.

```
Desktop  ──ws──►  Relay  ◄──ws──  Worker
                (forwards frames it cannot read)
```

The Worker dials **out** to the relay, which is what makes it reachable from
behind NAT.

## Running it

```bash
# on a small VM you control
node apps/relay/dist/index.js          # listens on :8787 (AIW_RELAY_PORT)

# on the Worker machine
aiw worker init --relay ws://relay.example.com:8787
aiw worker start
```

The Worker prints the address to give the Desktop:

```
[worker] reachable at: ws://relay.example.com:8787/client?id=<workerId>
```

Add that as the workstation address in the Desktop app and pair with the usual
code from `aiw worker status`.

## What the relay stores

Nothing. There is no database, no disk write, and no buffering beyond the
sockets themselves — no repositories, prompts, conversations, terminal
history, media or files. Restarting it loses nothing because it holds nothing.

It also never parses the application protocol: after the first control message
it forwards frames as opaque bytes.

## Trust model — read this before running one

**The relay can see your traffic.** Frames are plaintext JSON, so TLS (`wss://`)
protects the network hop but the relay operator sits inside that boundary and
can read prompts, code, terminal output and file contents in transit.

This is weaker than the "only forwards encrypted traffic" goal. End-to-end
encryption is a separate, unimplemented milestone. Until it lands:

- **Run your own relay.** Do not use one operated by someone you would not
  hand a shell on your machine.
- **Terminate TLS** (`wss://`) so the hop itself is protected.
- Prefer a direct transport (Tailscale/WireGuard/LAN/SSH) whenever you can —
  those are genuinely end-to-end.

The relay is deliberately built so encryption can be added without changing
it: because it never interprets frames, encrypted payloads will pass through
unmodified.

### What the relay cannot do

It cannot authenticate itself to a Worker. Pairing-code auth is enforced by
the Worker at the far end, so a relay that forwards a wrong code sees the
Worker reject it — verified in testing. A malicious relay could, however,
*read* a pairing code as it passes through and then impersonate the Desktop.
This is the same exposure as the plaintext point above, and the same fix.

## Current limitations

- **One Desktop per Worker.** The application protocol has no client
  multiplexing, so a second Desktop attaching would see the first one's
  responses. The relay refuses the second connection instead.
- **A rejected login briefly drops the link.** The Worker treats the relay
  connection as a single client, so refusing a bad pairing code closes that
  socket. The Worker reconnects automatically (exponential backoff) and is
  reachable again within seconds — verified — but a client repeatedly
  presenting a wrong code can keep interrupting the link.
