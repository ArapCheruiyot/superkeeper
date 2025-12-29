console.log("🚀 sales.js loaded (MVP READY TO SHIP!)");

const sellBtn = document.getElementById("sell-btn");

// ================================
// GET SHOP ID (Priority order)
// ================================
let CURRENT_SHOP_ID = null;

async function getShopId() {
    // Priority 1: Check if set in window
    if (window.currentShopId) {
        console.log("✅ Shop ID from window:", window.currentShopId);
        return window.currentShopId;
    }

    // Priority 2: Try to get from Firebase Auth
    try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js");
        const auth = getAuth();
        
        if (auth.currentUser) {
            console.log("✅ Shop ID from Firebase Auth:", auth.currentUser.uid);
            return auth.currentUser.uid;
        }
    } catch (e) {
        console.log("⚠️ Could not get shop ID from auth:", e);
    }

    // Priority 3: Ask backend for available shops
    try {
        const res = await fetch("/debug-cache");
        const data = await res.json();
        
        if (data.all_shop_ids && data.all_shop_ids.length > 0) {
            const shopId = data.all_shop_ids[0];
            console.log("✅ Shop ID from backend (first available):", shopId);
            return shopId;
        }
    } catch (e) {
        console.log("⚠️ Could not get shop ID from backend:", e);
    }

    // Priority 4: Fallback
    console.log("⚠️ Using fallback shop ID");
    return "sv3SMGkaM7ThgN4qYIasDKKDGsB3";
}

// Initialize shop ID on page load
(async () => {
    CURRENT_SHOP_ID = await getShopId();
    console.log("🏪 Current Shop ID:", CURRENT_SHOP_ID);
})();

let salescamStream = null;
let cart = [];

sellBtn.addEventListener("click", async () => {
    // Make sure we have shop ID before opening camera
    if (!CURRENT_SHOP_ID) {
        CURRENT_SHOP_ID = await getShopId();
    }
    
    if (!CURRENT_SHOP_ID) {
        alert("❌ Could not determine shop ID. Please contact support.");
        return;
    }
    
    openSalesCamera();
});

function openSalesCamera() {
    if (document.getElementById("salescam-root")) return;

    const root = document.createElement("div");
    root.id = "salescam-root";
    root.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: black;
        all: initial;
        font-family: system-ui, sans-serif;
    `;

    root.innerHTML = `
        <video id="salescam-video"
               autoplay playsinline
               style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">
        </video>

        <div style="
            position:absolute;
            top:15%;
            left:15%;
            width:70%;
            height:70%;
            border:4px dashed rgba(255,255,255,.8);
            pointer-events:none;">
        </div>

        <button id="salescam-close"
            style="
                position:absolute;
                top:60px;
                left:16px;
                width:44px;
                height:44px;
                border-radius:9999px;
                background:rgba(0,0,0,.7);
                color:white;
                font-size:20px;
                border:none;
                cursor:pointer;
                z-index:10;">
            ✕
        </button>

        <div id="salescam-cart-icon"
            style="
                position:absolute;
                top:60px;
                right:16px;
                display:none;
                align-items:center;
                gap:8px;
                background:rgba(0,0,0,.8);
                padding:8px 16px;
                border-radius:9999px;
                color:white;
                cursor:pointer;
                z-index:10;">
            <span style="font-size:24px;">🛒</span>
            <span id="salescam-cart-count" style="font-weight:bold;font-size:18px;">0</span>
        </div>

        <div style="
            position:absolute;
            bottom:24px;
            width:100%;
            display:flex;
            flex-direction:column;
            align-items:center;
            gap:8px;
            z-index:10;">
            
            <div id="salescam-result"></div>

            <button id="salescam-scan"
                style="
                    padding:14px 36px;
                    font-size:18px;
                    border-radius:9999px;
                    background:white;
                    color:black;
                    font-weight:600;
                    border:none;
                    cursor:pointer;">
                Scan
            </button>
        </div>

        <canvas id="salescam-canvas" style="display:none;"></canvas>
    `;

    document.body.appendChild(root);

    document.getElementById("salescam-close").onclick = closeSalesCamera;
    document.getElementById("salescam-scan").onclick = scanSalesItem;
    document.getElementById("salescam-cart-icon").onclick = showCheckout;

    updateCartIcon();
    startSalesCamera();
}

async function startSalesCamera() {
    const video = document.getElementById("salescam-video");
    salescamStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
    });
    video.srcObject = salescamStream;
}

function closeSalesCamera() {
    salescamStream?.getTracks().forEach(t => t.stop());
    salescamStream = null;
    document.getElementById("salescam-root")?.remove();
}

function playBeep(type = "scan") {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === "scan") {
        oscillator.frequency.value = 800;
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } else if (type === "success") {
        oscillator.frequency.value = 1200;
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } else if (type === "error") {
        oscillator.frequency.value = 400;
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    }
}

async function scanSalesItem() {
    const video = document.getElementById("salescam-video");
    const canvas = document.getElementById("salescam-canvas");
    const result = document.getElementById("salescam-result");
    const scanBtn = document.getElementById("salescam-scan");

    if (!video.videoWidth) return;

    playBeep("scan");

    scanBtn.disabled = true;
    result.innerHTML = `<div style="color:white;font-size:16px;">🔍 Scanning...</div>`;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    const frame = canvas.toDataURL("image/jpeg", 0.85);

    console.log("📤 Sending to backend with shop_id:", CURRENT_SHOP_ID);

    try {
        const res = await fetch("/sales", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shop_id: CURRENT_SHOP_ID, frame })
        });

        const data = await res.json();
        scanBtn.disabled = false;
        result.innerHTML = "";

        console.log("📥 Backend response:", data);

        if (!data.match) {
            playBeep("error");
            result.innerHTML = `<div style="color:white;font-size:16px;">❌ No match found</div>`;
            return;
        }

        playBeep("success");

        let thumbnailUrl = data.match.thumbnail;
        if (!thumbnailUrl || thumbnailUrl === "null" || thumbnailUrl === "undefined") {
            thumbnailUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect fill='%23ddd' width='60' height='60'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-size='24'%3E?%3C/text%3E%3C/svg%3E";
        }

        result.innerHTML = `
            <div style="
                display:flex;
                gap:12px;
                align-items:center;
                background:rgba(0,0,0,.9);
                padding:12px 16px;
                border-radius:12px;
                color:white;
                max-width:90%;">
                
                <img src="${thumbnailUrl}"
                     onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2760%27 height=%2760%27%3E%3Crect fill=%27%23ddd%27 width=%2760%27 height=%2760%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27 font-size=%2724%27%3E?%3C/text%3E%3C/svg%3E'"
                     style="width:60px;height:60px;border-radius:8px;object-fit:cover;background:#f0f0f0;">
                
                <div style="flex:1;font-size:14px;">
                    <div style="font-weight:600;font-size:16px;margin-bottom:4px;">${data.match.name}</div>
                    <div style="opacity:.8;">Match: ${Math.round(data.match.score * 100)}%</div>
                    <div style="font-weight:600;color:#4ade80;font-size:16px;margin-top:4px;">
                        $${parseFloat(data.match.sellPrice || 0).toFixed(2)}
                    </div>
                </div>

                <div style="display:flex;gap:8px;">
                    <button id="salescam-reject" 
                        style="
                            width:44px;
                            height:44px;
                            border-radius:9999px;
                            background:rgba(239,68,68,.9);
                            color:white;
                            font-size:20px;
                            border:none;
                            cursor:pointer;">
                        ✕
                    </button>
                    <button id="salescam-accept"
                        style="
                            width:44px;
                            height:44px;
                            border-radius:9999px;
                            background:rgba(34,197,94,.9);
                            color:white;
                            font-size:20px;
                            border:none;
                            cursor:pointer;">
                        ✓
                    </button>
                </div>
            </div>
        `;

        document.getElementById("salescam-accept").onclick = () => promptQuantity(data.match);
        document.getElementById("salescam-reject").onclick = () => result.innerHTML = "";

    } catch (error) {
        console.error("Scan error:", error);
        playBeep("error");
        scanBtn.disabled = false;
        result.innerHTML = `<div style="color:red;font-size:16px;">⚠️ Scan failed</div>`;
    }
}

function promptQuantity(match) {
    const quantity = prompt(`Enter quantity for "${match.name}":`, "1");
    
    if (!quantity || isNaN(quantity) || parseInt(quantity) <= 0) {
        alert("Invalid quantity");
        return;
    }

    const qty = parseInt(quantity);
    const existingIndex = cart.findIndex(item => item.item_id === match.item_id);
    
    if (existingIndex >= 0) {
        cart[existingIndex].quantity += qty;
    } else {
        cart.push({
            item_id: match.item_id,
            category_id: match.category_id,
            name: match.name,
            thumbnail: match.thumbnail,
            sellPrice: parseFloat(match.sellPrice || 0),
            quantity: qty
        });
    }

    document.getElementById("salescam-result").innerHTML = "";
    updateCartIcon();
    playBeep("success");
}

function updateCartIcon() {
    const cartIcon = document.getElementById("salescam-cart-icon");
    const cartCount = document.getElementById("salescam-cart-count");
    
    if (!cartIcon || !cartCount) return;

    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    if (totalItems > 0) {
        cartIcon.style.display = "flex";
        cartCount.textContent = totalItems;
    } else {
        cartIcon.style.display = "none";
    }
}

function showCheckout() {
    if (cart.length === 0) {
        alert("Cart is empty");
        return;
    }

    const total = cart.reduce((sum, item) => sum + (item.sellPrice * item.quantity), 0);

    const itemsList = cart.map(item => `
        <div style="
            display:flex;
            justify-content:space-between;
            padding:12px;
            background:rgba(255,255,255,.1);
            border-radius:8px;
            margin-bottom:8px;">
            <div>
                <div style="font-weight:600;">${item.name}</div>
                <div style="opacity:.8;font-size:14px;">Qty: ${item.quantity} × $${item.sellPrice.toFixed(2)}</div>
            </div>
            <div style="font-weight:600;">$${(item.sellPrice * item.quantity).toFixed(2)}</div>
        </div>
    `).join("");

    const checkoutHTML = `
        <div style="
            position:fixed;
            inset:0;
            background:rgba(0,0,0,.95);
            z-index:2147483648;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:20px;">
            
            <div style="
                background:rgba(30,30,30,1);
                border-radius:16px;
                padding:24px;
                max-width:500px;
                width:100%;
                max-height:80vh;
                overflow-y:auto;
                color:white;">
                
                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    margin-bottom:20px;">
                    <h2 style="margin:0;font-size:24px;">Checkout</h2>
                    <button id="checkout-close" style="
                        background:none;
                        border:none;
                        color:white;
                        font-size:28px;
                        cursor:pointer;">✕</button>
                </div>

                <div style="margin-bottom:20px;">
                    ${itemsList}
                </div>

                <div style="
                    border-top:2px solid rgba(255,255,255,.2);
                    padding-top:16px;
                    margin-bottom:20px;">
                    <div style="
                        display:flex;
                        justify-content:space-between;
                        font-size:20px;
                        font-weight:700;
                        margin-bottom:20px;">
                        <span>Total:</span>
                        <span style="color:#4ade80;">$${total.toFixed(2)}</span>
                    </div>

                    <div style="margin-bottom:16px;">
                        <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Payment Method:</div>
                        <div style="display:flex;flex-direction:column;gap:8px;">
                            <label style="
                                display:flex;
                                align-items:center;
                                padding:12px;
                                background:rgba(255,255,255,.05);
                                border-radius:8px;
                                cursor:pointer;">
                                <input type="radio" name="payment" value="cash" checked
                                    style="margin-right:12px;width:20px;height:20px;cursor:pointer;">
                                <span style="font-size:20px;margin-right:8px;">💵</span>
                                <span>Cash</span>
                            </label>
                            <label style="
                                display:flex;
                                align-items:center;
                                padding:12px;
                                background:rgba(255,255,255,.05);
                                border-radius:8px;
                                cursor:pointer;">
                                <input type="radio" name="payment" value="mpesa"
                                    style="margin-right:12px;width:20px;height:20px;cursor:pointer;">
                                <span style="font-size:20px;margin-right:8px;">📱</span>
                                <span>M-Pesa</span>
                            </label>
                            <label style="
                                display:flex;
                                align-items:center;
                                padding:12px;
                                background:rgba(255,255,255,.05);
                                border-radius:8px;
                                cursor:pointer;">
                                <input type="radio" name="payment" value="card"
                                    style="margin-right:12px;width:20px;height:20px;cursor:pointer;">
                                <span style="font-size:20px;margin-right:8px;">💳</span>
                                <span>Card</span>
                            </label>
                            <label style="
                                display:flex;
                                align-items:center;
                                padding:12px;
                                background:rgba(255,255,255,.05);
                                border-radius:8px;
                                cursor:pointer;">
                                <input type="radio" name="payment" value="credit"
                                    style="margin-right:12px;width:20px;height:20px;cursor:pointer;">
                                <span style="font-size:20px;margin-right:8px;">📝</span>
                                <span>Credit (Pay Later)</span>
                            </label>
                        </div>
                    </div>
                </div>

                <button id="checkout-confirm" style="
                    width:100%;
                    padding:16px;
                    background:#22c55e;
                    color:white;
                    border:none;
                    border-radius:12px;
                    font-size:18px;
                    font-weight:600;
                    cursor:pointer;">
                    Complete Sale
                </button>
            </div>
        </div>
    `;

    const checkoutDiv = document.createElement("div");
    checkoutDiv.id = "salescam-checkout";
    checkoutDiv.innerHTML = checkoutHTML;
    document.body.appendChild(checkoutDiv);

    document.getElementById("checkout-close").onclick = () => checkoutDiv.remove();
    document.getElementById("checkout-confirm").onclick = () => completeSale(checkoutDiv, total);
}

async function completeSale(checkoutDiv, total) {
    const confirmBtn = document.getElementById("checkout-confirm");
    const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value || "cash";
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Processing...";

    try {
        const { db } = await import("./firebase-config.js");
        const { doc, updateDoc, increment, getDoc } = await import(
            "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js"
        );
        const { getAuth } = await import(
            "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js"
        );

        const auth = getAuth();
        const soldBy = auth.currentUser?.displayName || auth.currentUser?.email || "Staff";
        const timestamp = Date.now();
        const date = new Date().toLocaleDateString();
        const time = new Date().toLocaleTimeString();
        const receiptId = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        console.log("🔄 Processing sale for", cart.length, "items");

        for (const item of cart) {
            const itemRef = doc(
                db,
                "Shops",
                CURRENT_SHOP_ID,
                "categories",
                item.category_id,
                "items",
                item.item_id
            );

            const itemSnap = await getDoc(itemRef);
            const currentData = itemSnap.data() || {};
            const currentTransactions = currentData.stockTransactions || [];

            const saleTransaction = {
                id: `sale_${timestamp}_${Math.random().toString(36).substr(2, 6)}`,
                quantity: -item.quantity,
                date: date,
                timestamp: timestamp,
                soldBy: soldBy,
                type: "sale",
                sellPrice: item.sellPrice,
                totalAmount: item.sellPrice * item.quantity,
                paymentMethod: paymentMethod,
                receiptId: receiptId
            };

            const updatedTransactions = [...currentTransactions, saleTransaction];

            await updateDoc(itemRef, {
                stockTransactions: updatedTransactions,
                stock: increment(-item.quantity),
                lastTransactionId: saleTransaction.id,
                lastStockUpdate: timestamp,
                updatedAt: timestamp
            });

            console.log(`✅ Deducted ${item.quantity} units from ${item.name}`);
        }

        console.log("✅ All items processed, generating receipt...");

        showReceipt({
            receiptId,
            date,
            time,
            items: cart,
            total,
            paymentMethod,
            soldBy
        });

        cart = [];
        updateCartIcon();
        playBeep("success");
        checkoutDiv.remove();

        setTimeout(() => {
            const salesRoot = document.getElementById("salescam-root");
            if (salesRoot) {
                closeSalesCamera();
            }
        }, 100);

    } catch (error) {
        console.error("❌ Sale error:", error);
        console.error("Error details:", error.stack);
        alert(`Failed to complete sale: ${error.message}\n\nCheck console for details.`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Complete Sale";
    }
}

function showReceipt(receiptData) {
    const { receiptId, date, time, items, total, paymentMethod, soldBy } = receiptData;

    const itemsList = items.map(item => `
        <tr>
            <td style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,.1);">${item.name}</td>
            <td style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,.1);text-align:center;">${item.quantity}</td>
            <td style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,.1);text-align:right;">$${item.sellPrice.toFixed(2)}</td>
            <td style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,.1);text-align:right;font-weight:600;">$${(item.sellPrice * item.quantity).toFixed(2)}</td>
        </tr>
    `).join("");

    const paymentIcons = {
        cash: "💵",
        mpesa: "📱",
        card: "💳",
        credit: "📝"
    };

    const receiptHTML = `
        <div style="
            position:fixed;
            inset:0;
            background:rgba(0,0,0,.95);
            z-index:2147483649;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:20px;">
            
            <div style="
                background:white;
                color:black;
                border-radius:16px;
                padding:32px;
                max-width:500px;
                width:100%;
                max-height:80vh;
                overflow-y:auto;">
                
                <div style="text-align:center;margin-bottom:24px;">
                    <div style="font-size:40px;margin-bottom:8px;">✅</div>
                    <h2 style="margin:0;font-size:24px;color:#22c55e;">Sale Complete!</h2>
                </div>

                <div style="background:#f3f4f6;padding:20px;border-radius:12px;margin-bottom:20px;">
                    <div style="text-align:center;margin-bottom:16px;">
                        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">RECEIPT</div>
                        <div style="font-size:18px;font-weight:700;">${receiptId}</div>
                    </div>
                    
                    <div style="display:flex;justify-content:space-between;font-size:14px;color:#6b7280;margin-bottom:4px;">
                        <span>Date:</span>
                        <span>${date} ${time}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;color:#6b7280;margin-bottom:4px;">
                        <span>Served by:</span>
                        <span>${soldBy}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;color:#6b7280;">
                        <span>Payment:</span>
                        <span>${paymentIcons[paymentMethod]} ${paymentMethod.toUpperCase()}</span>
                    </div>
                </div>

                <table style="width:100%;margin-bottom:20px;font-size:14px;">
                    <thead>
                        <tr style="border-bottom:2px solid #e5e7eb;">
                            <th style="padding:8px 0;text-align:left;">Item</th>
                            <th style="padding:8px 0;text-align:center;">Qty</th>
                            <th style="padding:8px 0;text-align:right;">Price</th>
                            <th style="padding:8px 0;text-align:right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsList}
                    </tbody>
                </table>

                <div style="
                    display:flex;
                    justify-content:space-between;
                    font-size:24px;
                    font-weight:700;
                    padding:16px;
                    background:#22c55e;
                    color:white;
                    border-radius:12px;
                    margin-bottom:20px;">
                    <span>TOTAL</span>
                    <span>$${total.toFixed(2)}</span>
                </div>

                <button onclick="this.parentElement.parentElement.remove();"
                    style="
                        width:100%;
                        padding:16px;
                        background:#1f2937;
                        color:white;
                        border:none;
                        border-radius:12px;
                        font-size:16px;
                        font-weight:600;
                        cursor:pointer;">
                    Done
                </button>
            </div>
        </div>
    `;

    const receiptDiv = document.createElement("div");
    receiptDiv.innerHTML = receiptHTML;
    document.body.appendChild(receiptDiv);
}