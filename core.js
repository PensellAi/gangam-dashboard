/* Gangam store core: default catalog, pricing math and the data API.
 * Shared by the storefront (index.html) and the dashboard (admin.html). */
(function () {
  "use strict";

  var DEFAULT_CATALOG = {
    version: 1,
    settings: {
      whatsapp: "201115692748",
      vodafoneNumber: "",
      instapayUser: "",
      instapayLink: "",
      shippingFee: 0,
      shippingNote: "مصاريف الشحن بتختلف حسب المنطقة وبتبدأ من ١٥ ج.م"
    },
    products: [
      { id: "original", name: "Original", nameAr: "أوريجينال", desc: "شوكولاتة باللبن كلاسيك", tagline: "الكلاسيك عمره ما يخيب", price: 40, color: "#4B2BC8", image: "images/original.webp", active: true },
      { id: "choco-biscuits", name: "Choco Biscuits", nameAr: "شوكو بسكويت", desc: "شوكولاتة باللبن ببسكويت الشوكولاتة", tagline: "قرمشة في كل قطمة", price: 50, color: "#1550D6", image: "images/choco-biscuits.webp", active: true },
      { id: "hazelnut", name: "Hazelnut", nameAr: "بندق", desc: "شوكولاتة باللبن بالبندق", tagline: "البندق بيحلّيها", price: 60, color: "#7A3B22", image: "images/hazelnut.webp", active: true },
      { id: "dubai", name: "Dubai", nameAr: "دبي", desc: "شوكولاتة باللبن محشية كنافة وفستق", tagline: "طعم سعادة زيادة", price: 70, color: "#5DB52C", image: "images/dubai.webp", active: true },
      { id: "blueberry", name: "Blue Berry", nameAr: "بلوبيري", desc: "شوكولاتة باللبن محشية بلوبيري", tagline: "مود حلو", price: 60, color: "#9C7BE0", image: "images/blueberry.webp", active: true },
      { id: "caramel-biscuits", name: "Caramel Biscuits", nameAr: "كراميل بسكويت", desc: "شوكولاتة باللبن ببسكويت الكراميل", tagline: "كراميل وضحكة أكبر", price: 50, color: "#D2161E", image: "images/caramel-biscuits.webp", active: true },
      { id: "bon-bueno", name: "Bon Bueno", nameAr: "بون بوينو", desc: "شوكولاتة باللبن محشية كنافة وبون بوينو", tagline: "حلاوة في كل حتة", price: 60, color: "#C49A7C", image: "images/bon-bueno.webp", active: true },
      { id: "coffee", name: "Coffee", nameAr: "كوفي", desc: "شوكولاتة باللبن محشية قهوة", tagline: "لعشاق القهوة", price: 60, color: "#3DBE24", image: "images/coffee.webp", active: true },
      { id: "dark-50", name: "Dark 50%", nameAr: "دارك ٥٠٪", desc: "شوكولاتة داكنة ٥٠٪ بالبندق", tagline: "طعم أجرأ", price: 65, color: "#2A2422", image: "images/dark-50.webp", active: true }
    ],
    bundles: [
      {
        id: "family-pack", kind: "package", name: "باكدج العيلة", desc: "٦ قطع من أول ٦ أصناف في المنيو، واحدة من كل طعم",
        items: [
          { productId: "original", qty: 1 }, { productId: "choco-biscuits", qty: 1 }, { productId: "hazelnut", qty: 1 },
          { productId: "dubai", qty: 1 }, { productId: "blueberry", qty: 1 }, { productId: "caramel-biscuits", qty: 1 }
        ],
        price: 350, active: true, endsAt: ""
      }
    ],
    promos: [
      { code: "GAMGAM10", percent: 10, active: true }
    ]
  };

  var ORDER_STATUSES = [
    { id: "new", label: "جديد" },
    { id: "confirmed", label: "اتأكد" },
    { id: "shipped", label: "خرج للتوصيل" },
    { id: "delivered", label: "اتسلّم" },
    { id: "cancelled", label: "اتلغى" }
  ];
  var PAYMENT_LABELS = { cod: "الدفع عند الاستلام", vodafone: "فودافون كاش", instapay: "إنستاباي" };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function money(n) {
    n = round2(num(n));
    var s = (n % 1 === 0) ? String(n) : n.toFixed(2);
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ج.م";
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function bundleLive(b) {
    if (!b || !b.active) return false;
    if (b.endsAt && String(b.endsAt) < todayISO()) return false;
    return true;
  }
  function productById(catalog, id) {
    for (var i = 0; i < catalog.products.length; i++) if (catalog.products[i].id === id) return catalog.products[i];
    return null;
  }
  function bundleById(catalog, id) {
    for (var i = 0; i < catalog.bundles.length; i++) if (catalog.bundles[i].id === id) return catalog.bundles[i];
    return null;
  }
  function bundleItemsValue(catalog, b) {
    var sum = 0;
    (b.items || []).forEach(function (it) { var p = productById(catalog, it.productId); if (p) sum += num(p.price) * num(it.qty); });
    return sum;
  }
  function findPromo(catalog, code) {
    if (!code) return null;
    code = String(code).trim().toUpperCase();
    var list = catalog.promos || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code).toUpperCase() === code && list[i].active && num(list[i].percent) > 0) return { code: code, percent: Math.min(100, num(list[i].percent)) };
    }
    return null;
  }

  /* cart: [{type:'product'|'bundle', id, qty}]; promo: {code, percent} | null
   * The server repeats this exact calculation, so it is the source of truth. */
  function computeTotals(catalog, cart, promo) {
    var lines = [], subtotal = 0;
    (cart || []).forEach(function (c) {
      var qty = Math.max(0, Math.floor(num(c.qty)));
      if (!qty) return;
      if (c.type === "bundle") {
        var b = bundleById(catalog, c.id);
        if (!bundleLive(b)) return;
        lines.push({ type: "bundle", id: b.id, name: b.name, unit: num(b.price), qty: qty, total: num(b.price) * qty });
      } else {
        var p = productById(catalog, c.id);
        if (!p || !p.active) return;
        lines.push({ type: "product", id: p.id, name: p.name, unit: num(p.price), qty: qty, total: num(p.price) * qty });
      }
    });
    lines.forEach(function (l) { subtotal += l.total; });
    var discount = promo ? round2(subtotal * num(promo.percent) / 100) : 0;
    var shipping = lines.length ? num(catalog.settings && catalog.settings.shippingFee) : 0;
    return {
      lines: lines, subtotal: round2(subtotal), promo: promo || null, discount: discount, shipping: shipping,
      total: round2(subtotal - discount + shipping), count: lines.reduce(function (a, l) { return a + l.qty; }, 0)
    };
  }

  function orderMessage(order, totals) {
    var L = [];
    L.push("🍫 طلب جديد من Gangam");
    L.push("رقم الطلب: " + order.id);
    L.push("");
    L.push("الاسم: " + order.customer.name);
    L.push("الموبايل: " + order.customer.phone);
    L.push("العنوان: " + order.customer.address);
    if (order.customer.notes) L.push("ملاحظات: " + order.customer.notes);
    L.push("");
    L.push("الطلب:");
    totals.lines.forEach(function (l) { L.push("• " + l.name + " × " + l.qty + " = " + money(l.total)); });
    L.push("");
    L.push("المجموع: " + money(totals.subtotal));
    if (totals.promo) L.push("خصم " + totals.promo.code + " (" + totals.promo.percent + "%): -" + money(totals.discount));
    if (totals.shipping) L.push("الشحن: " + money(totals.shipping));
    L.push((!totals.shipping && order.shippingNote ? "الإجمالي من غير الشحن: " : "الإجمالي: ") + money(totals.total));
    if (!totals.shipping && order.shippingNote) L.push("الشحن: حسب المنطقة (" + order.shippingNote + ")");
    L.push("طريقة الدفع: " + (PAYMENT_LABELS[order.payment] || order.payment));
    if (order.payment !== "cod") L.push("صورة التحويل: مرفوعة مع الطلب" + (order.adminLink ? "\n" + order.adminLink : " في لوحة التحكم"));
    return L.join("\n");
  }
  function whatsappLink(phone, text) {
    var p = String(phone || "").replace(/\D/g, "");
    if (p.indexOf("0") === 0) p = "2" + p;
    return "https://wa.me/" + p + "?text=" + encodeURIComponent(text);
  }

  /* Shrink an image File into a JPEG/WebP data URL. */
  function compressImage(file, maxSide, type, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("read")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("decode")); };
        img.onload = function () {
          var s = Math.min(1, maxSide / Math.max(img.width, img.height));
          var c = document.createElement("canvas");
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          var ctx = c.getContext("2d");
          if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(type || "image/jpeg", quality || 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- browser storage helpers ---------- */
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ================= data API =================
   * Firebase mode when config.js has firebase settings; otherwise a local demo
   * that keeps everything in this browser. */
  var CFG = window.GAMGAM_CONFIG || {};
  var FB_CFG = CFG.firebase && CFG.firebase.apiKey && CFG.firebase.projectId ? CFG.firebase : null;
  var DEMO_PASSWORD = "gamgam2026";
  var SDK = "https://www.gstatic.com/firebasejs/11.4.0/";
  var MAX_SHOT_CHARS = 900000; // Firestore documents hold up to ~1MB

  var fbReady = null;
  function fb() {
    if (!fbReady) {
      fbReady = Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-firestore.js"), import(SDK + "firebase-auth.js")])
        .then(function (m) {
          var app = m[0].initializeApp(FB_CFG);
          return { fs: m[1], au: m[2], db: m[1].getFirestore(app), auth: m[2].getAuth(app) };
        });
    }
    return fbReady;
  }
  function normalizeCatalog(c) {
    var d = clone(DEFAULT_CATALOG);
    if (!c || typeof c !== "object") return d;
    return {
      version: 1,
      settings: Object.assign(d.settings, c.settings || {}),
      products: Array.isArray(c.products) ? c.products : d.products,
      bundles: Array.isArray(c.bundles) ? c.bundles : d.bundles,
      promos: Array.isArray(c.promos) ? c.promos : (c.promos === undefined ? d.promos : [])
    };
  }
  function makeOrderId() {
    var t = Date.now().toString(36).toUpperCase().slice(-5);
    var r = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, "0");
    return "GG-" + t + r;
  }
  function tsToISO(v) { return v && v.toDate ? v.toDate().toISOString() : (v || ""); }
  function authError(e) {
    var c = (e && e.code) || "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "الإيميل أو الباسورد غلط.";
    if (/too-many-requests/.test(c)) return "محاولات كتير. استنى شوية وجرّب تاني.";
    if (/popup-closed|cancelled-popup/.test(c)) return "اتقفلت نافذة جوجل قبل ما الدخول يكمل.";
    if (/unauthorized-domain/.test(c)) return "الدومين ده مش متضاف في Firebase ← Authentication ← Settings ← Authorized domains.";
    if (/network/.test(c)) return "مفيش اتصال بالإنترنت.";
    return "الدخول فشل (" + c + ").";
  }

  var api = {
    demo: !FB_CFG,
    demoPassword: DEMO_PASSWORD,

    /* ---------- storefront ---------- */
    cachedCatalog: function () {
      return normalizeCatalog(FB_CFG ? (lsGet("gg_catalog_cache") || DEFAULT_CATALOG) : (lsGet("gg_catalog") || DEFAULT_CATALOG));
    },
    getCatalog: function () {
      if (!FB_CFG) return Promise.resolve(api.cachedCatalog());
      return fb().then(function (F) { return F.fs.getDoc(F.fs.doc(F.db, "catalog", "main")); })
        .then(function (snap) {
          var c = normalizeCatalog(snap.exists() ? snap.data() : null);
          c.promos = [];
          lsSet("gg_catalog_cache", c);
          return c;
        });
    },
    checkPromo: function (code) {
      code = String(code || "").trim().toUpperCase();
      if (!FB_CFG) return Promise.resolve(findPromo(api.cachedCatalog(), code));
      if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return Promise.resolve(null);
      return fb().then(function (F) { return F.fs.getDoc(F.fs.doc(F.db, "promos", code)); })
        .then(function (s) { return s.exists() ? findPromo({ promos: [Object.assign({ code: code }, s.data())] }, code) : null; });
    },
    /* order: {customer, payment, cart, promoCode}; promo: {code, percent}|null; shot: dataURL|null */
    placeOrder: function (order, promo, shot) {
      var catalog = api.cachedCatalog();
      var totals = computeTotals(catalog, order.cart, promo);
      var id = makeOrderId();
      if (!FB_CFG) {
        var saved = Object.assign({}, order, { id: id, createdAt: new Date().toISOString(), status: "new", totals: totals, hasShot: !!shot, screenshot: shot || "" });
        var list = lsGet("gg_orders") || [];
        list.unshift(saved);
        if (!lsSet("gg_orders", list)) { saved.screenshot = ""; list[0] = saved; lsSet("gg_orders", list); }
        return Promise.resolve({ id: id, totals: totals });
      }
      if (shot && shot.length > MAX_SHOT_CHARS) return Promise.reject(new Error("shot_too_big"));
      return fb().then(function (F) {
        var b = F.fs.writeBatch(F.db);
        b.set(F.fs.doc(F.db, "orders", id), {
          customer: order.customer, payment: order.payment, cart: order.cart, promoCode: promo ? promo.code : "",
          totals: totals, status: "new", hasShot: !!shot, createdAt: F.fs.serverTimestamp()
        });
        if (shot) b.set(F.fs.doc(F.db, "orderShots", id), { img: shot });
        return b.commit();
      }).then(function () { return { id: id, totals: totals }; });
    },

    /* ---------- dashboard ---------- */
    /* calls back with {email} when signed in, null when signed out */
    onAuth: function (cb) {
      if (!FB_CFG) { var u = null; try { u = sessionStorage.getItem("gg_demo_user"); } catch (e) {} cb(u ? { email: u } : null); return; }
      fb().then(function (F) {
        F.au.getRedirectResult(F.auth).catch(function () {});
        F.au.onAuthStateChanged(F.auth, function (user) { cb(user && user.emailVerified ? { email: user.email } : null); });
      }, function () { cb(null); });
    },
    loginEmail: function (email, pw) {
      if (!FB_CFG) {
        if (pw !== DEMO_PASSWORD) return Promise.reject(new Error("كلمة السر غلط. في وضع التجربة هي " + DEMO_PASSWORD));
        try { sessionStorage.setItem("gg_demo_user", email || "demo"); } catch (e) {}
        return Promise.resolve({ email: email || "demo" });
      }
      var FF;
      return fb().then(function (F) { FF = F; return F.au.signInWithEmailAndPassword(F.auth, email, pw); })
        .then(function (r) {
          if (r.user.emailVerified) return { email: r.user.email };
          // admin access needs a verified email: send the link, then sign out until it is confirmed
          return FF.au.sendEmailVerification(r.user).catch(function () {}).then(function () { return FF.au.signOut(FF.auth); })
            .then(function () { throw new Error("بعتنالك لينك تأكيد على " + r.user.email + ". افتحه من الإيميل وبعدين ادخل تاني."); });
        }, function (e) { throw new Error(authError(e)); });
    },
    loginGoogle: function () {
      if (!FB_CFG) return Promise.reject(new Error("الدخول بجوجل بيشتغل بعد ربط Firebase."));
      return fb().then(function (F) {
        var p = new F.au.GoogleAuthProvider();
        return F.au.signInWithPopup(F.auth, p).catch(function (e) {
          if (/popup-blocked|operation-not-supported/.test(e.code)) return F.au.signInWithRedirect(F.auth, p);
          throw e;
        });
      }).then(function (r) { return r && r.user ? { email: r.user.email } : null; }, function (e) { throw new Error(authError(e)); });
    },
    resetPassword: function (email) {
      if (!FB_CFG) return Promise.reject(new Error("متاح بعد ربط Firebase."));
      return fb().then(function (F) { return F.au.sendPasswordResetEmail(F.auth, email); });
    },
    logout: function () {
      if (!FB_CFG) { try { sessionStorage.removeItem("gg_demo_user"); } catch (e) {} return Promise.resolve(); }
      return fb().then(function (F) { return F.au.signOut(F.auth); });
    },
    adminCatalog: function () {
      if (!FB_CFG) return Promise.resolve(normalizeCatalog(lsGet("gg_catalog") || DEFAULT_CATALOG));
      return fb().then(function (F) {
        return Promise.all([F.fs.getDoc(F.fs.doc(F.db, "catalog", "main")), F.fs.getDocs(F.fs.collection(F.db, "promos"))]);
      }).then(function (r) {
        var c = normalizeCatalog(r[0].exists() ? r[0].data() : null);
        if (r[0].exists()) {
          c.promos = r[1].docs.map(function (d) { var x = d.data(); return { code: d.id, percent: num(x.percent), active: !!x.active }; });
        }
        c._fresh = !r[0].exists();
        return c;
      });
    },
    saveCatalog: function (catalog, previousPromoCodes) {
      var c = clone(catalog); delete c._fresh;
      if (!FB_CFG) { if (!lsSet("gg_catalog", c)) return Promise.reject(new Error("storage_full")); return Promise.resolve(true); }
      var promos = c.promos || []; delete c.promos;
      if (JSON.stringify(c).length > 950000) return Promise.reject(new Error("too_big"));
      return fb().then(function (F) {
        var b = F.fs.writeBatch(F.db);
        b.set(F.fs.doc(F.db, "catalog", "main"), c);
        var keep = {};
        promos.forEach(function (p) { keep[p.code] = 1; b.set(F.fs.doc(F.db, "promos", p.code), { percent: num(p.percent), active: !!p.active }); });
        (previousPromoCodes || []).forEach(function (code) { if (!keep[code]) b.delete(F.fs.doc(F.db, "promos", code)); });
        return b.commit();
      }).then(function () { return true; });
    },
    /* product photos are kept small and stored inside the catalog document */
    uploadImage: function (dataUrl) { return Promise.resolve(dataUrl); },
    getOrders: function () {
      if (!FB_CFG) return Promise.resolve(lsGet("gg_orders") || []);
      return fb().then(function (F) {
        return F.fs.getDocs(F.fs.query(F.fs.collection(F.db, "orders"), F.fs.orderBy("createdAt", "desc"), F.fs.limit(300)));
      }).then(function (s) {
        return s.docs.map(function (d) { var o = d.data(); o.id = d.id; o.createdAt = tsToISO(o.createdAt); return o; });
      });
    },
    getShot: function (id) {
      if (!FB_CFG) { var o = (lsGet("gg_orders") || []).find(function (x) { return x.id === id; }); return Promise.resolve(o && o.screenshot || ""); }
      return fb().then(function (F) { return F.fs.getDoc(F.fs.doc(F.db, "orderShots", id)); }).then(function (s) { return s.exists() ? s.data().img : ""; });
    },
    setOrderStatus: function (id, status) {
      if (!FB_CFG) {
        var list = lsGet("gg_orders") || [];
        list.forEach(function (o) { if (o.id === id) o.status = status; });
        lsSet("gg_orders", list);
        return Promise.resolve(true);
      }
      return fb().then(function (F) { return F.fs.updateDoc(F.fs.doc(F.db, "orders", id), { status: status }); });
    }
  };



  window.GG = {
    DEFAULT_CATALOG: DEFAULT_CATALOG, ORDER_STATUSES: ORDER_STATUSES, PAYMENT_LABELS: PAYMENT_LABELS,
    clone: clone, num: num, money: money, bundleLive: bundleLive, productById: productById, bundleById: bundleById,
    bundleItemsValue: bundleItemsValue, findPromo: findPromo, computeTotals: computeTotals, orderMessage: orderMessage,
    whatsappLink: whatsappLink, compressImage: compressImage, lsGet: lsGet, lsSet: lsSet, todayISO: todayISO, api: api
  };
})();
