(() => {
  const $ = (id) => document.getElementById(id);
  const main = $("main");
  const logEl = $("log");
  const RH = {
    chainId: "0x1237",
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  };
  const NFT_ABI = [
    "function name() view returns (string)",
    "function totalMinted() view returns (uint256)",
    "function nextId() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
    "function safeTransferFrom(address,address,uint256)",
    "function getApproved(uint256) view returns (address)",
    "function approve(address,uint256)",
    "function isApprovedForAll(address,address) view returns (bool)",
    "function setApprovalForAll(address,bool)",
  ];
  const BOOK_ABI = [
    "function allowed(address) view returns (bool)",
    "function listingCount() view returns (uint256)",
    "function listingAt(uint256) view returns (address seller, address nft, uint256 tokenId, uint256 price)",
    "function getListing(address,uint256) view returns (address seller, address nft, uint256 tokenId, uint256 price)",
    "function list(address,uint256,uint256)",
    "function cancel(address,uint256)",
    "function buy(address,uint256) payable",
  ];
  let cfg = null;
  let catalog = [];
  let mirrors = {};
  let provider = null;
  let signer = null;
  let account = "";
  let wallet = null;
  let walletWatch = null;
  const announced = [];
  let viewGen = 0;
  let busy = false;
  const ownedCache = new Map();

  function log(s) {
    logEl.textContent = new Date().toISOString().slice(11, 19) + "  " + s;
  }
  function errText(e) {
    return (e && (e.shortMessage || e.reason || e.message)) || String(e);
  }
  function short(addr) {
    if (!addr || addr.length < 10) return addr || "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }
  function isAddr(s) {
    return /^0x[a-fA-F0-9]{40}$/.test(s || "");
  }
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v != null) node.setAttribute(k, v);
    });
    (kids || []).forEach((kid) => { if (kid) node.append(kid); });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function findCollection(addr) {
    return catalog.find((c) => c.address.toLowerCase() === String(addr || "").toLowerCase());
  }
  const PAGE_PLAY = {
    "0xc36a1a553e953b53b98dfe3ae6ef9276f330f439": "https://nftzworld.github.io/cook/play-{id}.html",
    "0x28bc0634afbeceea0c1fb1cfcdcd9cc10f5ca42a": "https://nftzworld.github.io/hook/play-{id}.html",
    "0xe0145de817ab510a7c3439e7727e202ea2657688": "https://nftzworld.github.io/pixap/play-{id}.html",
    "0xd8aeb1580643211246442f475375d48a0dd657d2": "https://nftzworld.github.io/folio2/play-{id}.html",
    "0xf3052374cfb97dc6b8da56e4f725035a2a4c2aed": "https://nftzworld.github.io/mahjong/play.html",
    "0xdad08579c430b18fcd104e2db0219c5a1423ff0c": "https://nftzworld.github.io/yap/play.html",
    "0x42ca9a5fefe18453d9b6a2175592c580784dc4f0": "https://nftzworld.github.io/pap2-one/play.html",
    "0x77973da54f5125963c57d303741c525c1e510e90": "https://nftzworld.github.io/bonkit/play-{id}.html",
    "0xa633650cea933c2c594013ff0dc0e33dfe6e39b8": "https://nftzworld.github.io/notepin/play-{id}.html",
    "0xf770a2d3e947444b4536f8a3dd06654f0b2c3824": "https://nftzworld.github.io/kitchencounter/play-{id}.html",
    "0xe38c7d0ed787ae6ab5a2b40dc7cc3a2001320abd": "https://nftzworld.github.io/byte/play-{id}.html",
    "0xf197e65c7f09bf8fea40b1092ac62791648f199f": "https://nftzworld.github.io/word/play-{id}.html"
  };
  // Token 1 of these two sets is published as play.html. play-1.html is not on the page.
  const PLAY_HTML_FOR_ONE = {
    "0xe0145de817ab510a7c3439e7727e202ea2657688": "https://nftzworld.github.io/pixap/play.html",
    "0xd8aeb1580643211246442f475375d48a0dd657d2": "https://nftzworld.github.io/folio2/play.html"
  };
  function pagePlay(addr, id) {
    const key = String(addr || "").toLowerCase();
    if (String(id) === "1" && PLAY_HTML_FOR_ONE[key]) return PLAY_HTML_FOR_ONE[key];
    const pat = PAGE_PLAY[key];
    if (!pat) return "";
    return pat.replace("{id}", String(id));
  }
  function mirrorPlay(addr, id) {
    const pat = mirrors[String(addr || "").toLowerCase()];
    if (!pat) return "";
    return pat.replace("{id}", String(id));
  }
  function knownPlay(addr, id) {
    return pagePlay(addr, id) || mirrorPlay(addr, id);
  }
  function httpsUrl(raw) {
    if (!raw || typeof raw !== "string") return "";
    if (raw.startsWith("ipfs://")) return "https://gateway.pinata.cloud/ipfs/" + raw.slice(7);
    if (raw.startsWith("https://")) return raw;
    return "";
  }
  function artUrl(raw) {
    const url = httpsUrl(raw);
    if (!url) return "";
    try {
      const host = new URL(url).hostname;
      if (!cfg.pages && (host === "files.catbox.moe" || host === "gateway.pinata.cloud")) {
        return "/art-proxy?u=" + encodeURIComponent(url);
      }
    } catch (e) { /* keep the direct link */ }
    return url;
  }
  function lookAddr() {
    const box = $("look");
    const typed = (box && box.value || "").trim();
    if (isAddr(typed)) return typed;
    return cfg.shop;
  }
  // Rabby sets isMetaMask and takes window.ethereum. Connect uses rdns io.metamask.
  function pickMetaMask(rows, ethereum) {
    const list = Array.isArray(rows) ? rows : [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || !row.info || !row.provider) continue;
      if (row.info.rdns === "io.metamask" && !row.provider.isRabby) return row.provider;
    }
    const pool = [];
    if (ethereum) {
      pool.push(ethereum);
      const extra = ethereum.providers || ethereum.detected;
      if (Array.isArray(extra)) {
        for (let i = 0; i < extra.length; i++) pool.push(extra[i]);
      }
    }
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p && p.isMetaMask && !p.isRabby) return p;
    }
    return null;
  }
  function rememberWallet(event) {
    const detail = event && event.detail;
    if (!detail || !detail.info || !detail.provider) return;
    const uuid = detail.info.uuid || detail.info.rdns;
    if (!uuid) return;
    const prior = announced.findIndex((row) => (row.info.uuid || row.info.rdns) === uuid);
    if (prior >= 0) announced[prior] = detail;
    else announced.push(detail);
  }
  function askWallets() {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  function whenMetaMask() {
    askWallets();
    const found = pickMetaMask(announced, window.ethereum);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      const finish = () => {
        const hit = pickMetaMask(announced, window.ethereum);
        if (!hit) return;
        window.removeEventListener("eip6963:announceProvider", finish);
        clearTimeout(timer);
        resolve(hit);
      };
      const timer = setTimeout(() => {
        window.removeEventListener("eip6963:announceProvider", finish);
        resolve(pickMetaMask(announced, window.ethereum));
      }, 400);
      window.addEventListener("eip6963:announceProvider", finish);
      askWallets();
    });
  }
  function onWalletChange() {
    bindSigner().then(render).catch((e) => log(errText(e)));
  }
  function watchWallet(next) {
    if (!next || !next.on || walletWatch === next) return;
    if (walletWatch && walletWatch.removeListener) {
      walletWatch.removeListener("accountsChanged", onWalletChange);
      walletWatch.removeListener("chainChanged", onWalletChange);
    }
    walletWatch = next;
    next.on("accountsChanged", onWalletChange);
    next.on("chainChanged", onWalletChange);
  }

  function nft(addr, runner) {
    return new ethers.Contract(addr, NFT_ABI, runner || provider);
  }
  function book(runner) {
    if (!cfg.market) throw new Error("LOCKED. The book is not deployed.");
    return new ethers.Contract(cfg.market, BOOK_ABI, runner || provider);
  }
  function markNav(head) {
    document.querySelectorAll(".desk-panel a").forEach((a) => {
      const href = a.getAttribute("href");
      const on = (head === "book" && href === "#/book") || (head === "" && href === "#/");
      a.classList.toggle("on", on);
    });
    const parts = (location.hash || "#/").replace(/^#/, "").split("/").filter(Boolean);
    const hold = $("navHold");
    if (hold) {
      if ((head === "t" || head === "c") && parts[1]) {
        hold.href = "#/c/" + parts[1];
        hold.hidden = false;
      } else {
        hold.hidden = true;
      }
    }
    const inspect = $("navInspect");
    if (inspect) {
      if (cfg.pages) {
        inspect.hidden = true;
      } else if (head === "t" && parts[1] && parts[2]) {
        inspect.hidden = false;
        inspect.href = "http://127.0.0.1:5477/?q=" + encodeURIComponent(parts[1] + " " + parts[2]);
      } else {
        inspect.hidden = false;
        inspect.href = "http://127.0.0.1:5477/";
      }
    }
  }

  function watchInspecter() {
    const node = $("neighbor");
    if (!node) return;
    if (cfg.pages) {
      node.textContent = "The book is not deployed.";
      return;
    }
    const tick = () => {
      fetch("http://127.0.0.1:5477/", { mode: "no-cors", cache: "no-store" })
        .then(() => { node.textContent = "Inspecter is on"; })
        .catch(() => { node.textContent = "Inspecter is off. Open the Inspecter icon."; });
    };
    tick();
    setInterval(tick, 15000);
  }

  const PLAY_SIZES = ["phone", "pad", "desk", "wall"];
  function applySize(size) {
    if (!PLAY_SIZES.includes(size)) size = "desk";
    document.body.dataset.size = size;
    try { sessionStorage.setItem("nogate-play-size", size); } catch (e) { /* private window */ }
    const sel = $("playSize");
    if (sel) sel.value = size;
  }


  function keyArt(letter) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 72 84");
    svg.setAttribute("aria-hidden", "true");
    const plate = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    plate.setAttribute("class", "plate");
    plate.setAttribute("x", "1");
    plate.setAttribute("y", "1");
    plate.setAttribute("width", "70");
    plate.setAttribute("height", "82");
    plate.setAttribute("rx", "14");
    const face = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    face.setAttribute("class", "face");
    face.setAttribute("x", "7");
    face.setAttribute("y", "7");
    face.setAttribute("width", "58");
    face.setAttribute("height", "70");
    face.setAttribute("rx", "10");
    const glyph = document.createElementNS("http://www.w3.org/2000/svg", "text");
    glyph.setAttribute("class", "ink");
    glyph.setAttribute("x", "36");
    glyph.setAttribute("y", "54");
    glyph.setAttribute("text-anchor", "middle");
    glyph.setAttribute("font-size", "32");
    glyph.setAttribute("font-family", "ui-monospace, monospace");
    glyph.setAttribute("font-weight", "700");
    glyph.textContent = letter;
    [[5, 5], [67, 5], [5, 79], [67, 79]].forEach(([x, y]) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("class", "screw");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "1.7");
      svg.append(dot);
    });
    svg.append(plate, face, glyph);
    svg.querySelectorAll(".screw").forEach((dot) => svg.append(dot));
    return svg;
  }

  async function boot() {
    const [c, cat, mir] = await Promise.all([
      fetch("config.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("catalog.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("mirrors.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})),
    ]);
    cfg = c;
    catalog = cat;
    mirrors = mir || {};
    provider = new ethers.JsonRpcProvider(cfg.rpc, cfg.chainId, { staticNetwork: true, batchMaxCount: 40 });
    $("btnConnect").addEventListener("click", connect);
    let savedSize = "desk";
    try { savedSize = sessionStorage.getItem("nogate-play-size") || "desk"; } catch (e) { /* private window */ }
    applySize(savedSize);
    $("playSize").addEventListener("change", () => applySize($("playSize").value));
    $("btnReload").addEventListener("click", () => {
      const frame = document.querySelector(".sheet .frame.live iframe");
      if (!frame || !frame.getAttribute("src")) { log("Open a token first."); return; }
      const src = frame.src;
      frame.src = "about:blank";
      frame.src = src;
      log("Reloading the app.");
    });
    document.addEventListener("click", (e) => {
      const menu = $("deskMenu");
      if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
    });
    watchInspecter();
    window.addEventListener("eip6963:announceProvider", rememberWallet);
    askWallets();
    wallet = pickMetaMask(announced, window.ethereum);
    watchWallet(wallet);
    window.addEventListener("hashchange", render);
    render();
  }

  async function connect() {
    try {
      wallet = await whenMetaMask();
      if (!wallet) { log("MetaMask is not in this browser."); return; }
      watchWallet(wallet);
      await wallet.request({ method: "eth_requestAccounts" });
      try {
        await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: RH.chainId }] });
      } catch (e) {
        if (e && e.code === 4902) {
          await wallet.request({ method: "wallet_addEthereumChain", params: [RH] });
        } else {
          throw e;
        }
      }
      await bindSigner();
      log("Connected " + account);
      render();
    } catch (e) {
      log(errText(e));
    }
  }

  async function bindSigner() {
    askWallets();
    wallet = pickMetaMask(announced, window.ethereum);
    if (!wallet) return;
    watchWallet(wallet);
    const browser = new ethers.BrowserProvider(wallet);
    const net = await browser.getNetwork();
    if (Number(net.chainId) !== Number(cfg.chainId)) {
      signer = null;
      $("btnConnect").textContent = "Wrong chain";
      log("Switch the wallet to Robinhood chain.");
      return;
    }
    const accounts = await browser.listAccounts();
    if (!accounts.length) {
      signer = null;
      account = "";
      $("btnConnect").textContent = "Connect";
      return;
    }
    signer = await browser.getSigner();
    account = await signer.getAddress();
    $("btnConnect").textContent = short(account);
  }

  function render() {
    const gen = ++viewGen;
    const parts = (location.hash || "#/").replace(/^#/, "").split("/").filter(Boolean);
    const head = parts[0] || "";
    markNav(head);
    if (head === "book") return pageBook(gen);
    if (head === "c" && parts[1]) return pageCollection(parts[1], parts[2] === "shop", gen);
    if (head === "t" && parts[1] && parts[2]) return pageToken(parts[1], parts[2], gen);
    return pageDirectory();
  }

  function shelfName(name) {
    const raw = String(name || "");
    return raw.replace(/^NFTzWORLD\s+/i, "").trim() || raw;
  }

  function shelfLetter(name) {
    const ch = shelfName(name).charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : "#";
  }

  function isPreview(item) {
    return !!(item && item.status === "PREVIEW" && item.port && item.supply);
  }

  function parseLook(raw) {
    const text = String(raw || "").trim();
    const addr = text.match(/0x[a-fA-F0-9]{40}/);
    if (!addr) return null;
    let id = "";
    const inst = text.match(/instance\/(\d+)/i);
    const slash = text.match(/0x[a-fA-F0-9]{40}\/(\d+)/);
    const tail = text.match(/0x[a-fA-F0-9]{40}\D+(\d+)\s*$/);
    if (inst) id = inst[1];
    else if (slash) id = slash[1];
    else if (tail) id = tail[1];
    return { item: findCollection(addr[0]), id };
  }

  function pageDirectory() {
    clear(main);
    const q = el("input", {
      type: "search",
      id: "q",
      placeholder: "Collection name, or paste a token address",
      spellcheck: "false",
    });
    q.autocomplete = "off";
    const tid = el("input", { type: "number", id: "tid", min: "1", step: "1", value: "1", inputmode: "numeric" });
    const open = el("button", { type: "submit", class: "solid", text: "Open" });
    const letters = el("div", { class: "letters" });
    const hits = el("div", { class: "hits" });
    const hint = el("p", { class: "dim hint", text: "Pick a letter. Then open one token." });
    const groups = new Map();
    catalog.forEach((item) => {
      const key = shelfLetter(item.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    let letter = "";
    let picked = null;
    const paint = () => {
      const needle = q.value.trim().toLowerCase();
      const pasted = parseLook(q.value);
      let rows = [];
      if (pasted) {
        rows = pasted.item ? [pasted.item] : [];
        if (pasted.id) tid.value = pasted.id;
      } else if (needle) {
        rows = catalog.filter((item) => {
          const blob = (item.name + " " + shelfName(item.name) + " " + item.address).toLowerCase();
          return blob.includes(needle);
        });
      } else if (letter) {
        rows = groups.get(letter) || [];
      }
      clear(hits);
      if (!needle && !letter && !pasted) {
        hint.hidden = false;
        if (picked) hits.append(el("p", { class: "picked", text: picked.name }));
        return;
      }
      hint.hidden = true;
      if (pasted && !pasted.item) {
        hits.append(el("p", { class: "dim", text: "That contract is not on this desk." }));
        return;
      }
      if (!rows.length) {
        hits.append(el("p", { class: "dim", text: "No collection matches." }));
        return;
      }
      if (rows.length === 1) picked = rows[0];
      rows.forEach((item) => {
        const b = el("button", { type: "button", text: item.name });
        if (picked && picked.address.toLowerCase() === item.address.toLowerCase()) b.classList.add("on");
        b.addEventListener("click", () => {
          picked = item;
          paint();
        });
        hits.append(b);
      });
    };
    [...groups.keys()].sort().forEach((key) => {
      const b = el("button", { type: "button", class: "key", "aria-label": key });
      b.append(keyArt(key));
      b.addEventListener("click", () => {
        letter = letter === key ? "" : key;
        q.value = "";
        letters.querySelectorAll("button").forEach((n) => n.classList.toggle("on", n === b && !!letter));
        paint();
      });
      letters.append(b);
    });
    q.addEventListener("input", () => {
      letter = "";
      letters.querySelectorAll("button").forEach((n) => n.classList.remove("on"));
      const typed = q.value.trim().toLowerCase();
      const exact = catalog.find((item) => item.name.toLowerCase() === typed || shelfName(item.name).toLowerCase() === typed);
      if (exact) picked = exact;
      paint();
    });
    const form = el("form", { class: "finder" });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pasted = parseLook(q.value);
      if (pasted && !pasted.item) { log("That contract is not on this desk."); return; }
      const item = pasted ? pasted.item : picked;
      const id = String((pasted && pasted.id) || tid.value || "").trim();
      if (!item) { log("Pick a collection."); return; }
      if (!/^\d+$/.test(id) || Number(id) < 1) { log("Name a token number."); return; }
      location.hash = "#/t/" + item.address + "/" + id;
    });
    form.append(
      el("p", { class: "kicker", text: "One token" }),
      q,
      letters,
      hint,
      hits,
      el("div", { class: "row openline" }, [tid, open])
    );
    main.append(form);
    q.focus();
  }

  async function supplyOf(addr) {
    const c = nft(addr);
    try { return Number(await c.totalMinted()); } catch (e) { /* older desks */ }
    try {
      const n = Number(await c.nextId());
      return n > 0 ? n - 1 : 0;
    } catch (e) { /* fall through */ }
    try { return Number(await c.totalSupply()); } catch (e) { /* unknown */ }
    return 0;
  }

  async function ownedIds(collection, holder, gen, onStep) {
    const key = collection.toLowerCase() + ":" + holder.toLowerCase();
    if (ownedCache.has(key)) return ownedCache.get(key);
    const supply = await supplyOf(collection);
    const c = nft(collection);
    const mine = [];
    const step = 40;
    for (let start = 1; start <= supply; start += step) {
      if (gen !== viewGen) return null;
      const end = Math.min(supply, start + step - 1);
      if (onStep) onStep(end, supply);
      const ids = [];
      for (let id = start; id <= end; id++) ids.push(id);
      const owners = await Promise.all(ids.map(async (id) => {
        try { return [id, (await c.ownerOf(id)).toLowerCase()]; }
        catch (e) { return [id, ""]; }
      }));
      owners.forEach(([id, who]) => { if (who === holder.toLowerCase()) mine.push(id); });
    }
    const result = { supply, ids: mine };
    ownedCache.set(key, result);
    return result;
  }

  function pagePreviewCollection(item, gen) {
    clear(main);
    const grid = el("div", { class: "grid", id: "grid" });
    const supply = Number(item.supply);
    main.append(
      el("h2", { text: item.name }),
      el("p", { class: "dim", text: "Preview. Not minted. The desk key is not a contract." }),
      el("p", { class: "mono", text: "http://127.0.0.1:" + item.port + "/" }),
      grid
    );
    for (let id = 1; id <= supply; id++) {
      const card = el("a", { class: "token", href: "#/t/" + item.address + "/" + id }, [
        el("div", { class: "ph" }),
        el("p", { text: "#" + id }),
      ]);
      const pic = document.createElement("img");
      pic.alt = "";
      const ph = card.firstChild;
      pic.addEventListener("load", () => { if (ph.parentNode === card) ph.replaceWith(pic); });
      pic.addEventListener("error", () => { if (ph.parentNode === card) ph.remove(); });
      pic.src = "http://127.0.0.1:" + item.port + "/stills/" + id + ".jpg";
      grid.append(card);
    }
    if (gen !== viewGen) return;
  }

  function pagePreviewToken(item, id, gen) {
    const supply = Number(item.supply);
    clear(main);
    if (!Number.isInteger(id) || id < 1 || id > supply) {
      main.append(el("p", { text: "That token is not on this desk." }));
      return;
    }
    const sheet = el("div", { class: "sheet" });
    const frame = el("div", { class: "frame", hidden: "hidden" });
    const side = el("div", { class: "side" });
    const title = el("h2", { text: item.name + " #" + id });
    const src = "http://127.0.0.1:" + item.port + "/play-" + id + ".html";
    side.append(
      el("p", {}, [
        el("a", { href: "#/", text: "Back" }),
        " · ",
        el("a", { href: "#/c/" + item.address, text: "The " + supply }),
        " · ",
        el("a", { href: "http://127.0.0.1:" + item.port + "/", text: "Desk" }),
      ]),
      el("p", { class: "mono", text: "Preview. Not minted." }),
      el("p", { class: "dim", text: "Deploy stays locked. The book does not list this." })
    );
    sheet.append(frame, title, side);
    main.append(sheet);
    const play = el("button", { type: "button", class: "solid", text: "Play" });
    side.insertBefore(play, side.firstChild);
    function openLocal() {
      frame.hidden = false;
      frame.classList.add("live");
      sheet.classList.add("has-art");
      const view = document.createElement("iframe");
      view.title = title.textContent;
      view.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
      view.src = src;
      frame.replaceChildren(view);
      play.disabled = true;
      play.textContent = "Playing";
    }
    play.addEventListener("click", openLocal);
    fetch(src, { cache: "no-store" }).then((res) => {
      if (gen !== viewGen) return;
      if (!res.ok) throw new Error("The app did not answer.");
      return res.text();
    }).then((html) => {
      if (gen !== viewGen || html == null) return;
      if (!/<!doctype html|<html/i.test(html)) throw new Error("That file is not an app.");
      openLocal();
    }).catch((e) => {
      if (gen !== viewGen) return;
      frame.hidden = false;
      frame.replaceChildren(el("p", { class: "empty", text: errText(e) }));
      log(errText(e));
    });
    fetch("http://127.0.0.1:" + item.port + "/meta/" + id + ".json", { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("Metadata " + res.status);
      return res.json();
    }).then((meta) => {
      if (gen !== viewGen || !meta) return;
      if (meta.name) title.textContent = meta.name;
      if (meta.description) side.append(el("p", { class: "desc", text: String(meta.description) }));
      if (Array.isArray(meta.attributes) && meta.attributes.length) {
        const ul = el("ul", { class: "traits" });
        meta.attributes.forEach((a) => {
          if (!a || typeof a !== "object") return;
          ul.append(el("li", {}, [
            el("span", { text: String(a.trait_type || "Trait") }),
            el("strong", { text: String(a.value ?? "") }),
          ]));
        });
        side.append(ul);
      }
    }).catch((e) => {
      if (gen !== viewGen) return;
      log(errText(e));
    });
  }

  async function pageCollection(addr, readShop, gen) {
    const item = findCollection(addr);
    clear(main);
    if (!item) {
      main.append(el("p", { text: "That collection is not on this desk." }));
      return;
    }
    if (isPreview(item)) {
      pagePreviewCollection(item, gen);
      return;
    }
    const look = el("input", {
      type: "text",
      id: "look",
      value: account || cfg.shop,
      spellcheck: "false",
    });
    const jump = el("input", { type: "number", min: "1", step: "1", placeholder: "Token #" });
    const status = el("p", { class: "dim", id: "status", text: "Reading supply…" });
    const grid = el("div", { class: "grid", id: "grid" });
    const go = el("button", { type: "button", class: "solid", text: "Read holdings" });
    go.addEventListener("click", () => load());
    look.classList.add("wide");
    main.append(
      el("h2", { text: item.name }),
      el("p", { class: "mono", text: item.address }),
      el("div", { class: "row" }, [look]),
      el("div", { class: "row" }, cfg.shop ? [
        go,
        el("button", { type: "button", text: "Shop wallet", onclick: () => { look.value = cfg.shop; } }),
      ] : [go]),
      el("div", { class: "row" }, [
        jump,
        el("button", { type: "button", text: "Open token", onclick: () => openJump() }),
      ]),
      status,
      grid
    );
    supplyOf(item.address).then((n) => {
      if (gen !== viewGen) return;
      if ($("status") && $("status").textContent === "Reading supply…") {
        $("status").textContent = n + " minted. Read a wallet, or open one token.";
      }
    }).catch(() => {});
    function openJump() {
      const n = Number(jump.value);
      if (!Number.isInteger(n) || n < 1) { log("Name a token number."); return; }
      location.hash = "#/t/" + item.address + "/" + n;
    }
    async function load() {
      const holder = lookAddr();
      if (!isAddr(holder)) { log("That is not a wallet address."); return; }
      go.disabled = true;
      status.textContent = "Reading the chain…";
      clear(grid);
      try {
        const found = await ownedIds(item.address, holder, gen, (end, supply) => {
          if (gen !== viewGen) return;
          status.textContent = "Reading " + end + " / " + supply;
        });
        if (!found || gen !== viewGen) return;
        status.textContent = found.ids.length + " of " + found.supply + " sit with " + short(holder);
        log(found.ids.length + " held of " + found.supply);
        if (!found.ids.length) {
          grid.append(el("div", { class: "note", text: "Nothing in this collection for that wallet." }));
        }
        const io = new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);
            fillCard(en.target, item.address, Number(en.target.dataset.id));
          });
        }, { rootMargin: "240px" });
        found.ids.forEach((id) => {
          const card = el("a", { class: "token", href: "#/t/" + item.address + "/" + id }, [
            el("div", { class: "ph" }),
            el("p", { text: "#" + id }),
          ]);
          card.dataset.id = String(id);
          grid.append(card);
          io.observe(card);
        });
      } catch (e) {
        if (gen !== viewGen) return;
        status.textContent = errText(e);
        log(errText(e));
      } finally {
        if (gen === viewGen) go.disabled = false;
      }
    }
    if (readShop) {
      look.value = cfg.shop;
      load();
    }
  }

  async function metaOf(addr, id) {
    const uri = await nft(addr).tokenURI(id);
    const url = httpsUrl(uri);
    if (!url) throw new Error("Metadata link is not https.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error("Metadata " + res.status);
      return await res.json();
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("Metadata did not answer.");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fillCard(card, addr, id) {
    try {
      const meta = await metaOf(addr, id);
      const img = artUrl(meta.image);
      if (img) {
        const pic = document.createElement("img");
        const ph = card.firstChild;
        pic.alt = "";
        pic.addEventListener("load", () => { if (ph.parentNode === card) ph.replaceWith(pic); });
        pic.addEventListener("error", () => { if (ph.parentNode === card) ph.remove(); });
        pic.src = img;
      }
      if (meta.name) card.lastChild.textContent = meta.name;
    } catch (e) { /* the number stays */ }
  }

  async function pageToken(addr, idRaw, gen) {
    if (!/^\d+$/.test(idRaw)) {
      clear(main);
      main.append(el("p", { text: "That token is not on this desk." }));
      return;
    }
    const id = Number(idRaw);
    const item = findCollection(addr);
    clear(main);
    if (!item || id < 1) {
      main.append(el("p", { text: "That token is not on this desk." }));
      return;
    }
    if (isPreview(item)) {
      pagePreviewToken(item, id, gen);
      return;
    }
    const sheet = el("div", { class: "sheet" });
    const frame = el("div", { class: "frame", hidden: "hidden" });
    const side = el("div", { class: "side" });
    const title = el("h2", { text: item.name + " #" + id });
    const ownerP = el("p", { class: "mono", text: "Reading owner…" });
    const to = el("input", { type: "text", placeholder: "Send to 0x…", spellcheck: "false" });
    const price = el("input", { type: "text", inputmode: "decimal", placeholder: "Price in ETH", spellcheck: "false" });
    price.disabled = !cfg.market;
    const sendBtn = el("button", { type: "button", class: "solid", text: account ? "Send" : "Connect to send" });
    sendBtn.disabled = true;
    const listBtn = el("button", { type: "button", text: cfg.market ? "List for sale" : "List stays locked" });
    listBtn.disabled = !cfg.market;
    const cancelBtn = el("button", { type: "button", text: cfg.market ? "Cancel listing" : "Cancel stays locked" });
    cancelBtn.disabled = true;
    sendBtn.addEventListener("click", () => sendToken(item, id, to.value.trim()));
    listBtn.addEventListener("click", () => listToken(item, id, price.value.trim()));
    cancelBtn.addEventListener("click", () => cancelToken(item, id));
    side.append(
      el("p", {}, [
        el("a", { href: "#/", text: "Back" }),
        " · ",
        el("a", { href: "#/c/" + item.address, text: "Holdings" }),
        " · ",
        el("a", { href: cfg.explorer + "/token/" + item.address + "/instance/" + id, text: "Explorer" }),
      ].concat(!cfg.pages ? [
        " · ",
        el("a", {
          href: "http://127.0.0.1:5477/?q=" + encodeURIComponent(item.address + " " + id),
          target: "_blank",
          rel: "noreferrer",
          text: "Inspect",
        }),
      ] : [])),
      el("div", { class: "row" }, [to, sendBtn]),
      el("div", { class: "row" }, [price, listBtn]),
      el("div", { class: "row" }, [cancelBtn])
    );
    sheet.append(frame, title, ownerP, side);
    main.append(sheet);

    nft(item.address).ownerOf(id).then(async (owner) => {
      if (gen !== viewGen) return;
      ownerP.textContent = "Held by " + owner;
      const mine = account && owner.toLowerCase() === account.toLowerCase();
      if (mine) sendBtn.disabled = false;
      else if (!account) sendBtn.textContent = "Connect to send";
      else sendBtn.textContent = "Not in this wallet";
      if (!cfg.market) return;
      const row = await book().getListing(item.address, id);
      if (gen !== viewGen) return;
      if (row.price > 0n) {
        side.insertBefore(el("p", { class: "dim", text: "Listed at " + ethers.formatEther(row.price) + " ETH by " + short(row.seller) }), side.children[0]);
        if (account && row.seller.toLowerCase() === account.toLowerCase()) cancelBtn.disabled = false;
      }
    }).catch((e) => {
      if (gen !== viewGen) return;
      ownerP.textContent = errText(e);
    });

    const known = cfg.pages ? knownPlay(item.address, id) : "";
    if (known) {
      const play = el("button", { type: "button", class: "solid", text: "Play" });
      play.addEventListener("click", () => openApp(known, item.name + " #" + id, gen));
      side.insertBefore(play, side.firstChild);
      openApp(known, item.name + " #" + id, gen);
    }

    metaOf(item.address, id).then((meta) => {
      if (gen !== viewGen) return;
      if (meta.name) title.textContent = meta.name;
      if (meta.description) {
        const d = String(meta.description);
        side.append(el("p", { class: "desc", text: d.length > 700 ? d.slice(0, 700) + "…" : d }));
      }
      if (Array.isArray(meta.attributes) && meta.attributes.length) {
        const ul = el("ul", { class: "traits" });
        meta.attributes.forEach((a) => {
          if (!a || typeof a !== "object") return;
          ul.append(el("li", {}, [
            el("span", { text: String(a.trait_type || "Trait") }),
            el("strong", { text: String(a.value ?? "") }),
          ]));
        });
        side.append(ul);
      }
      const anim = httpsUrl(meta.animation_url);
      if (known) return;
      if (anim) {
        const play = el("button", { type: "button", class: "solid", text: "Play" });
        play.addEventListener("click", () => openApp(anim, meta.name || ("Token " + id), gen));
        side.insertBefore(play, side.firstChild);
        openApp(anim, meta.name || ("Token " + id), gen);
        return;
      }
      const img = artUrl(meta.image);
      if (!img) return;
      const pic = document.createElement("img");
      pic.alt = "";
      pic.addEventListener("load", () => {
        if (frame.classList.contains("live")) return;
        frame.hidden = false;
      });
      pic.addEventListener("error", () => {
        if (frame.classList.contains("live")) return;
        frame.hidden = true;
        side.append(el("p", { class: "dim", text: "The still did not load." }));
      });
      pic.src = img;
      frame.replaceChildren(pic);
    }).catch((e) => {
      if (gen !== viewGen || known) return;
      const fallback = pagePlay(item.address, id);
      if (cfg.pages && fallback) {
        const play = el("button", { type: "button", class: "solid", text: "Play" });
        play.addEventListener("click", () => openApp(fallback, item.name + " #" + id, gen));
        side.insertBefore(play, side.firstChild);
        openApp(fallback, item.name + " #" + id, gen);
        log("Opening the page copy.");
        return;
      }
      if (cfg.pages) {
        log("This one is not on the page yet.");
        return;
      }
      log(errText(e));
    });

    async function openApp(anim, name, genAt) {
      const play = [...side.querySelectorAll("button")].find((b) => b.textContent === "Play" || b.textContent === "Opening…");
      if (play) {
        play.disabled = true;
        play.textContent = "Opening…";
      }
      frame.hidden = false;
      frame.classList.add("live");
      sheet.classList.add("has-art");
      frame.replaceChildren(el("p", { class: "empty", text: "Opening the app…" }));
      frame.scrollIntoView({ block: "start" });
      if (cfg.pages) {
        let host = "";
        try { host = new URL(anim).hostname; } catch (err) { host = ""; }
        if (host === "files.catbox.moe" || host === "litter.catbox.moe") {
          frame.replaceChildren(el("p", { class: "empty", text: "This one plays on the desk." }));
          if (play) {
            play.disabled = false;
            play.textContent = "Play";
          }
          log("This one plays on the desk.");
          return;
        }
        const view = document.createElement("iframe");
        view.title = name;
        view.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-pointer-lock");
        view.setAttribute("allow", "fullscreen; autoplay");
        view.referrerPolicy = "no-referrer";
        view.src = anim;
        frame.replaceChildren(view);
        if (play) play.textContent = "Playing";
        return;
      }
      const src = "/app-proxy?u=" + encodeURIComponent(anim);
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (genAt !== viewGen) return;
        if (!res.ok) throw new Error("The app did not answer.");
        const html = await res.text();
        if (!/<!doctype html|<html/i.test(html)) throw new Error("That file is not an app.");
        const view = document.createElement("iframe");
        view.title = name;
        // An opaque origin cannot open a microphone. The next port is a real
        // origin, and it is not this desk, so the app still cannot read the page.
        const playerPort = String(Number(location.port) + 1);
        view.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-pointer-lock allow-same-origin");
        view.setAttribute("allow", "fullscreen; microphone");
        view.referrerPolicy = "no-referrer";
        view.src = location.protocol + "//" + location.hostname + ":" + playerPort + src;
        frame.replaceChildren(view);
        if (play) play.textContent = "Playing";
      } catch (e) {
        if (genAt !== viewGen) return;
        frame.replaceChildren(el("p", { class: "empty", text: errText(e) }));
        if (play) {
          play.disabled = false;
          play.textContent = "Play";
        }
        log(errText(e));
      }
    }
  }

  async function sendToken(item, id, to) {
    if (busy) return;
    try {
      if (!signer) { log("Connect the wallet that holds the token."); return; }
      if (!isAddr(to)) { log("The recipient is not an address."); return; }
      const me = await signer.getAddress();
      const owner = await nft(item.address).ownerOf(id);
      if (owner.toLowerCase() !== me.toLowerCase()) { log("This wallet does not hold that token."); return; }
      if (!window.confirm("Send " + item.name + " #" + id + " to " + to + ". This cannot be undone.")) return;
      busy = true;
      const tx = await nft(item.address, signer)["safeTransferFrom(address,address,uint256)"](me, to, id);
      log("Send " + tx.hash);
      await tx.wait();
      ownedCache.clear();
      log("Sent " + item.name + " #" + id);
      render();
    } catch (e) {
      log(errText(e));
    } finally {
      busy = false;
    }
  }

  async function listToken(item, id, priceEth) {
    if (busy) return;
    try {
      if (!cfg.market) throw new Error("LOCKED. The book is not deployed.");
      if (!signer) { log("Connect the wallet that holds the token."); return; }
      const price = ethers.parseEther(priceEth);
      if (price <= 0n) { log("Name a price above zero."); return; }
      const me = await signer.getAddress();
      const token = nft(item.address, signer);
      if ((await token.ownerOf(id)).toLowerCase() !== me.toLowerCase()) { log("This wallet does not hold that token."); return; }
      const market = book(signer);
      if (!(await market.allowed(item.address))) { log("This collection is not on the book yet."); return; }
      const approved = await token.getApproved(id);
      const all = await token.isApprovedForAll(me, cfg.market);
      if (approved.toLowerCase() !== cfg.market.toLowerCase() && !all) {
        if (!window.confirm("Let NoGate move this one token when it sells. The rest of the collection stays put.")) return;
        busy = true;
        const approve = await token.approve(cfg.market, id);
        log("Approval " + approve.hash);
        await approve.wait();
        busy = false;
      }
      if (!window.confirm("List " + item.name + " #" + id + " for " + priceEth + " ETH. You keep the token until it sells.")) return;
      busy = true;
      const tx = await market.list(item.address, id, price);
      log("List " + tx.hash);
      await tx.wait();
      log("Listed " + item.name + " #" + id);
      render();
    } catch (e) {
      log(errText(e));
    } finally {
      busy = false;
    }
  }

  async function cancelToken(item, id) {
    if (busy) return;
    try {
      if (!cfg.market) throw new Error("LOCKED. The book is not deployed.");
      if (!signer) { log("Connect the wallet that listed the token."); return; }
      if (!window.confirm("Take " + item.name + " #" + id + " off the book.")) return;
      busy = true;
      const tx = await book(signer).cancel(item.address, id);
      log("Cancel " + tx.hash);
      await tx.wait();
      log("Cancelled " + item.name + " #" + id);
      render();
    } catch (e) {
      log(errText(e));
    } finally {
      busy = false;
    }
  }

  async function pageBook(gen) {
    clear(main);
    main.append(
      el("h2", { text: "Book" }),
      el("div", { class: "note" }, [
        el("p", { text: "A buyer pays the price you name. The token moves in that same transaction. NoGate does not hold it in the meantime." }),
        el("p", { text: "If the token pays a royalty, that royalty is the only cut. If it pays none, the book takes 5% for the shop wallet. The two cuts are not stacked." }),
        el("p", { text: cfg.market ? "Book " + cfg.market : "The book is not on chain. List, Cancel, and Buy stay locked until you ask to deploy." }),
      ])
    );
    const grid = el("div", { class: "cards" });
    main.append(grid);
    if (!cfg.market) {
      grid.append(el("div", { class: "note", text: "No listings yet." }));
      return;
    }
    try {
      const market = book();
      const count = Number(await market.listingCount());
      if (gen !== viewGen) return;
      if (!count) {
        grid.append(el("div", { class: "note", text: "The book is empty." }));
        return;
      }
      for (let i = 0; i < count; i++) {
        if (gen !== viewGen) return;
        const row = await market.listingAt(i);
        const item = findCollection(row.nft);
        const name = (item ? item.name : short(row.nft)) + " #" + row.tokenId;
        const price = ethers.formatEther(row.price);
        const card = el("div", { class: "card" }, [
          el("strong", { text: name }),
          el("span", { text: price + " ETH · " + short(row.seller) }),
        ]);
        if (item) card.append(el("a", { href: "#/t/" + item.address + "/" + row.tokenId, text: "Open" }));
        const buyBtn = el("button", {
          type: "button",
          class: "solid",
          text: "Buy",
          onclick: () => buyToken(row.nft, row.tokenId, name, price),
        });
        buyBtn.style.marginTop = "10px";
        card.append(buyBtn);
        if (account && row.seller.toLowerCase() === account.toLowerCase() && item) {
          const cancelBtn = el("button", {
            type: "button",
            text: "Cancel",
            onclick: () => cancelToken(item, Number(row.tokenId)),
          });
          cancelBtn.style.marginTop = "10px";
          cancelBtn.style.marginLeft = "8px";
          card.append(cancelBtn);
        }
        grid.append(card);
      }
    } catch (e) {
      grid.append(el("div", { class: "note", text: errText(e) }));
    }
  }

  async function buyToken(nftAddr, id, name, priceEth) {
    if (busy) return;
    try {
      if (!cfg.market) throw new Error("LOCKED. The book is not deployed.");
      if (!signer) { log("Connect a wallet to buy."); return; }
      if (!window.confirm("Buy " + name + " for " + priceEth + " ETH.")) return;
      busy = true;
      const tx = await book(signer).buy(nftAddr, id, { value: ethers.parseEther(priceEth) });
      log("Buy " + tx.hash);
      await tx.wait();
      ownedCache.clear();
      log("Bought " + name);
      render();
    } catch (e) {
      log(errText(e));
    } finally {
      busy = false;
    }
  }

  boot().catch((e) => log(errText(e)));
})();
