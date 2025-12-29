// itemDetailOverlay.js
// Polished item capture with clear feedback, persistent CTA, and smooth UX
// FIX: always send image_index to backend for embedding

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const CLOUDINARY_CLOUD = "decckqobb";
const CLOUDINARY_UPLOAD_PRESET = "Superkeeper";
const FLASK_BACKEND_URL = window.location.origin;

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("overlay");
  const overlayContent = document.querySelector(".overlay-content");
  const itemDetail = document.getElementById("item-detail");
  const itemNameEl = document.getElementById("item-name");
  const itemMeta = document.getElementById("item-meta");
  const editToggleBtn = document.getElementById("edit-toggle-btn");

  let currentItem = null;
  let captureInProgress = false;
  let capturePhase = null;
  let editMode = false;

  console.log("itemDetailOverlay.js loaded (polished, fixed)");

  // -------------------
  // Backend notify helper (fire-and-forget)
  // -------------------
  function sendImageForEmbedding(imageUrl, imageIndex) {
    if (!imageUrl || !currentItem || imageIndex == null) return;

    const payload = {
      event: "image_saved",
      image_url: imageUrl,
      item_id: currentItem.itemId,
      shop_id: currentItem.uid,
      category_id: currentItem.categoryId,
      image_index: imageIndex,
      timestamp: Date.now()
    };

    console.log("[EMBED PAYLOAD → BACKEND]", payload);

    fetch(`${FLASK_BACKEND_URL}/vectorize-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => console.log("[BACKEND RESPONSE]", data))
      .catch(err => console.warn("Backend request failed:", err));
  }

  // -------------------
  // Edit / Save toggle - UPDATED
  // -------------------
  if (editToggleBtn) {
    editToggleBtn.addEventListener("click", async () => {
      if (editMode) {
        // We're in edit mode, clicking "Save"
        await saveEdits();
        editMode = false;
        editToggleBtn.textContent = "Edit";
      } else {
        // We're in view mode, clicking "Edit"
        editMode = true;
        editToggleBtn.textContent = "Save";
      }
      renderItemMeta(currentItem?.data);
    });
  }

  // -------------------
  // Save edits to Firestore
  // -------------------
  async function saveEdits() {
    if (!currentItem) return;

    // Get updated values from UI
    const nameInput = document.getElementById("item-name-input");
    const buyPriceInput = document.getElementById("buy-price-input");
    const sellPriceInput = document.getElementById("sell-price-input");

    const updatedName = nameInput ? nameInput.value.trim() : currentItem.data.name;
    const updatedBuyPrice = buyPriceInput ? parseFloat(buyPriceInput.value) || 0 : currentItem.data.buyPrice || 0;
    const updatedSellPrice = sellPriceInput ? parseFloat(sellPriceInput.value) || 0 : currentItem.data.sellPrice || 0;

    // Update Firestore
    const itemRef = doc(
      db,
      "Shops",
      currentItem.uid,
      "categories",
      currentItem.categoryId,
      "items",
      currentItem.itemId
    );

    try {
      await updateDoc(itemRef, {
        name: updatedName,
        buyPrice: updatedBuyPrice,
        sellPrice: updatedSellPrice,
        updatedAt: Date.now()
      });

      // Update currentItem data
      currentItem.data.name = updatedName;
      currentItem.data.buyPrice = updatedBuyPrice;
      currentItem.data.sellPrice = updatedSellPrice;
      currentItem.name = updatedName;

      console.log("✅ Item updated successfully");
    } catch (error) {
      console.error("Error updating item:", error);
      alert("Failed to save changes. Please try again.");
    }
  }

  // -------------------
  // Show item detail
  // -------------------
  async function showItemDetail(name, uid, categoryId, itemId) {
    editMode = false;
    if (editToggleBtn) editToggleBtn.textContent = "Edit";

    // Show item detail on top of categories
    overlay.classList.remove("hidden");
    overlayContent.classList.add("hidden");
    itemDetail.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    const itemRef = doc(db, "Shops", uid, "categories", categoryId, "items", itemId);
    const snap = await getDoc(itemRef);
    const data = snap.exists() ? snap.data() : { 
      name, 
      images: [],
      stock: 0,
      stockTransactions: []
    };

    currentItem = { uid, categoryId, itemId, name, data };
    renderItemMeta(data);

    // Inject item detail close button
    injectItemDetailCloseButton();

    if (!Array.isArray(data.images) || data.images.length === 0) {
      await captureImage1(itemRef, data);
      return;
    }

    if (data.images.length === 1) {
      capturePhase = "awaiting-image-2";
      injectCaptureCTA(itemRef, data.images);
      return;
    }

    await ensurePrices(itemRef, data);
    renderItemMeta(currentItem.data);
  }

  // -------------------
  // Inject item detail close button
  // -------------------
  function injectItemDetailCloseButton() {
    // Only inject if not already exists
    if (itemDetail && !document.getElementById("item-detail-close-btn")) {
      const closeBtn = document.createElement("span");
      closeBtn.id = "item-detail-close-btn";
      closeBtn.className = "close-x";
      closeBtn.setAttribute("role", "button");
      closeBtn.setAttribute("aria-label", "Close item detail and go back to categories");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.position = "absolute";
      closeBtn.style.top = "10px";
      closeBtn.style.right = "15px";
      closeBtn.style.fontSize = "24px";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.zIndex = "1002"; // Above item detail content
      itemDetail.appendChild(closeBtn);

      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (captureInProgress) return alert("Finish image capture first.");
        hideItemDetail();
      });
    }
  }

  // -------------------
  // Capture image 1
  // -------------------
  async function captureImage1(itemRef, data) {
    capturePhase = "processing-image-1";
    showStatus("Opening camera for photo 1…");
    setPlaceholderMessage(0, "Processing first image…");

    const file = await promptCameraCapture();
    clearStatus();

    if (!file) {
      capturePhase = null;
      setPlaceholderMessage(0, "No image");
      return;
    }

    const preview = URL.createObjectURL(file);
    setPreviewImageSlot(0, preview);

    const url = await uploadToCloudinary(file);
    const images = [url];

    // Initialize with stock data
    await setDoc(itemRef, { 
      ...data, 
      images, 
      stock: 0,
      stockTransactions: [],
      createdAt: Date.now() 
    }, { merge: true });
    
    currentItem.data.images = images;
    setPreviewImageSlot(0, url);

    sendImageForEmbedding(url, 0); // ✅ index fixed

    capturePhase = "awaiting-image-2";
    injectCaptureCTA(itemRef, images);
  }

  // -------------------
  // Inject CTA for image 2
  // -------------------
  function injectCaptureCTA(itemRef, images) {
    const actions = itemMeta.querySelector(".capture-actions");
    if (!actions) return;

    actions.innerHTML = "";

    const info = document.createElement("div");
    info.textContent = "Photo 1 saved. Capture image 2.";
    info.style.marginBottom = "6px";

    const btn = document.createElement("button");
    btn.textContent = "Capture image 2";
    btn.style.padding = "10px 14px";

    btn.onclick = async () => {
      btn.disabled = true;
      capturePhase = "processing-image-2";
      info.textContent = "Opening camera for photo 2…";
      showStatus("Preparing second image…");
      setPlaceholderMessage(1, "Processing image 2…");

      const file = await promptCameraCapture();
      clearStatus();

      if (!file) {
        btn.disabled = false;
        capturePhase = "awaiting-image-2";
        info.textContent = "Photo 1 saved. Capture image 2.";
        setPlaceholderMessage(1, "No image");
        return;
      }

      const preview = URL.createObjectURL(file);
      setPreviewImageSlot(1, preview);
      showStatus("Uploading second image…");

      const url = await uploadToCloudinary(file);
      images[1] = url;

      await updateDoc(itemRef, { images, updatedAt: Date.now() });
      currentItem.data.images = images;
      setPreviewImageSlot(1, url);

      sendImageForEmbedding(url, 1); // ✅ index fixed

      capturePhase = null;
      actions.innerHTML = "";
      showStatus("Image 2 saved. Processing item…");

      await ensurePrices(itemRef, currentItem.data);
      renderItemMeta(currentItem.data);
      clearStatus();
    };

    actions.append(info, btn);
  }

  // -------------------
  // Ensure prices
  // -------------------
  async function ensurePrices(itemRef, data) {
    if (data.buyPrice != null && data.sellPrice != null) return;

    const buy = prompt("Enter buy price:", data.buyPrice ?? "");
    const sell = prompt("Enter sell price:", data.sellPrice ?? "");

    await updateDoc(itemRef, {
      buyPrice: parseFloat(buy || 0),
      sellPrice: parseFloat(sell || 0),
      updatedAt: Date.now()
    });

    currentItem.data = (await getDoc(itemRef)).data();
  }

  // -------------------
  // Add Stock Function
  // -------------------
  async function addStockToItem() {
    if (!currentItem) {
      console.error("❌ No item selected for stock addition");
      return;
    }

    // 1. Ask for quantity
    const quantity = prompt(`How many units of "${currentItem.name}" to add?`, "10");
    if (!quantity || isNaN(quantity) || parseInt(quantity) <= 0) {
      alert("Please enter a valid number");
      return;
    }

    const qty = parseInt(quantity);

    // 2. Auto-capture data
    const timestamp = Date.now();
    const date = new Date().toLocaleDateString();
    
    // Get user info
    let addedBy = "Staff";
    try {
      const auth = getAuth();
      if (auth.currentUser) {
        addedBy = auth.currentUser.displayName || auth.currentUser.email || "User";
      }
    } catch (e) {
      console.log("Auth not available:", e);
    }

    // 3. Create transaction ID
    const txnId = `stock_${timestamp}_${Math.random().toString(36).substr(2, 6)}`;

    // 4. Create stock transaction
    const stockTransaction = {
      id: txnId,
      quantity: qty,
      date: date,
      timestamp: timestamp,
      addedBy: addedBy,
      type: "stock_in"
    };

    // 5. Get Firestore reference
    const itemRef = doc(
      db, "Shops", currentItem.uid, 
      "categories", currentItem.categoryId, 
      "items", currentItem.itemId
    );

    try {
      console.log("🔄 Adding stock to Firestore...");
      console.log("Item ID:", currentItem.itemId);
      console.log("Quantity:", qty);
      console.log("Transaction ID:", txnId);

      // 6. Update Firestore with arrayUnion and increment
      await updateDoc(itemRef, {
        stockTransactions: arrayUnion(stockTransaction),
        stock: increment(qty),
        lastTransactionId: txnId,
        lastStockUpdate: timestamp,
        updatedAt: timestamp
      });

      // 7. Update local data
      currentItem.data.stockTransactions = [
        ...(currentItem.data.stockTransactions || []),
        stockTransaction
      ];
      currentItem.data.stock = (currentItem.data.stock || 0) + qty;
      currentItem.data.lastTransactionId = txnId;
      currentItem.data.lastStockUpdate = timestamp;

      // 8. Calculate and verify
      const calculatedTotal = currentItem.data.stockTransactions.reduce((sum, t) => sum + t.quantity, 0);
      const storedTotal = currentItem.data.stock || 0;
      
      console.log("✅ STOCK ADDED SUCCESSFULLY!");
      console.log("Added quantity:", qty);
      console.log("New total stock:", storedTotal);
      console.log("Calculated from transactions:", calculatedTotal);
      console.log("Number of transactions:", currentItem.data.stockTransactions.length);
      console.log("Transaction ID:", txnId);
      
      if (storedTotal !== calculatedTotal) {
        console.warn("⚠️ Stock mismatch detected!");
        console.warn("Stored total:", storedTotal);
        console.warn("Calculated total:", calculatedTotal);
      }

      // 9. Show success message
      alert(`✅ Added ${qty} units\n\nTotal stock now: ${storedTotal} units`);

      // 10. Refresh UI
      renderItemMeta(currentItem.data);

    } catch (error) {
      console.error("❌ Error adding stock:", error);
      alert(`Failed to add stock: ${error.message}`);
    }
  }

  // -------------------
  // Render item meta - UPDATED with stock tracking
  // -------------------
  function renderItemMeta(data = {}) {
    const imgs = data.images || [];

    // Update item name in header
    if (itemNameEl) {
      if (editMode) {
        // Edit mode: show input field
        itemNameEl.innerHTML = `
          <input type="text" id="item-name-input" value="${data.name || ''}" 
                 style="font-size: 1.5rem; padding: 5px; width: 80%; border: 1px solid #ccc; border-radius: 4px;">
          <span class="pencil" style="margin-left: 10px; color: #666;">✎</span>
        `;
      } else {
        // View mode: show plain text
        itemNameEl.textContent = data.name || '';
      }
    }

    const imgHtml = [0, 1].map(i => {
      if (!imgs[i]) return `<div class="image-slot placeholder">No image</div>`;

      return `
        <div class="image-slot">
          <img src="${imgs[i]}" class="item-thumb">
          ${editMode ? `
            <div class="image-edit-overlay">
              <span class="pencil">✎</span>
              <button class="retake-btn" data-index="${i}">Retake</button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    // Render prices with pencil icons
    let pricesHtml;
    if (editMode) {
      // Edit mode: show input fields
      pricesHtml = `
        <div class="item-prices">
          <div style="margin-bottom: 8px; display: flex; align-items: center;">
            <span class="pencil" style="margin-right: 8px; color: #666;">✎</span>
            <label style="margin-right: 8px;">Buy Price:</label>
            <input type="number" id="buy-price-input" value="${data.buyPrice || ''}" 
                   step="0.01" min="0" style="padding: 4px; width: 100px; border: 1px solid #ccc; border-radius: 4px;">
          </div>
          <div style="display: flex; align-items: center;">
            <span class="pencil" style="margin-right: 8px; color: #666;">✎</span>
            <label style="margin-right: 8px;">Sell Price:</label>
            <input type="number" id="sell-price-input" value="${data.sellPrice || ''}" 
                   step="0.01" min="0" style="padding: 4px; width: 100px; border: 1px solid #ccc; border-radius: 4px;">
          </div>
        </div>
      `;
    } else {
      // View mode: show plain text
      pricesHtml = `
        <div class="item-prices">
          <p>Buy Price: ${data.buyPrice ?? "-"}</p>
          <p>Sell Price: ${data.sellPrice ?? "-"}</p>
        </div>
      `;
    }

    // Stock tracking section
    const totalStock = data.stock || 0;
    const transactions = data.stockTransactions || [];
    const lastThree = transactions.slice(-3).reverse();
    
    const stockHtml = `
      <div style="margin: 20px 0; padding: 15px; background: #f0f8ff; border: 2px solid #0077cc; border-radius: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <div>
            <div style="font-size: 16px; font-weight: bold; color: #0055aa;">📦 STOCK TRACKING</div>
            <div style="font-size: 32px; font-weight: bold; color: #0077cc;">
              ${totalStock}
              <span style="font-size: 16px; color: #666; margin-left: 5px;">units</span>
            </div>
            ${transactions.length > 0 ? `
              <div style="font-size: 12px; color: #888; margin-top: 5px;">
                Based on ${transactions.length} transaction${transactions.length === 1 ? '' : 's'}
              </div>
            ` : ''}
          </div>
          
          <button id="add-stock-btn" 
                  style="padding: 10px 20px; background: linear-gradient(135deg, #0077cc, #0055aa); 
                         color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; font-weight: bold;">
            ➕ Add Stock
          </button>
        </div>
        
        <!-- Recent transactions -->
        ${transactions.length > 0 ? `
          <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #cce7ff;">
            <div style="font-size: 14px; font-weight: bold; color: #0055aa; margin-bottom: 8px;">
              Recent Stock Additions:
            </div>
            <div style="max-height: 150px; overflow-y: auto;">
              ${lastThree.map(t => `
                <div style="padding: 10px; margin: 5px 0; background: white; border-radius: 6px; 
                            border-left: 4px solid #0077cc; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #333; font-weight: 500;">${t.date}</span>
                    <span style="font-weight: bold; color: #009900; font-size: 16px;">+${t.quantity}</span>
                  </div>
                  <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    Added by: ${t.addedBy}
                  </div>
                  ${t.id ? `<div style="font-size: 10px; color: #999; margin-top: 2px;">ID: ${t.id.substr(0, 10)}...</div>` : ''}
                </div>
              `).join('')}
            </div>
            
            ${transactions.length > 3 ? `
              <div style="text-align: center; margin-top: 10px;">
                <span style="font-size: 12px; color: #0077cc; font-style: italic;">
                  + ${transactions.length - 3} more records in database
                </span>
              </div>
            ` : ''}
          </div>
        ` : `
          <div style="margin-top: 15px; padding: 20px; text-align: center; color: #888; font-style: italic; background: white; border-radius: 6px;">
            No stock recorded yet. Click "Add Stock" to begin tracking inventory.
          </div>
        `}
        
        <!-- Debug info (visible in console) -->
        ${transactions.length > 0 ? `
          <script>
            console.log("📊 STOCK DEBUG INFO:");
            console.log("Total Stock:", ${totalStock});
            console.log("Transactions:", ${JSON.stringify(transactions)});
            console.log("Calculated Total:", ${transactions.reduce((sum, t) => sum + t.quantity, 0)});
          </script>
        ` : ''}
      </div>
    `;

    itemMeta.innerHTML = `
      <div class="item-images">${imgHtml}</div>
      ${pricesHtml}
      ${stockHtml}
      <div class="capture-actions"></div>
      <div class="capture-status"></div>
    `;

    // Bind the add stock button
    const addStockBtn = itemMeta.querySelector("#add-stock-btn");
    if (addStockBtn) {
      addStockBtn.addEventListener("click", addStockToItem);
    }

    if (editMode) bindRetakeButtons();
  }

  // -------------------
  // Retake image (edit mode)
  // -------------------
  function bindRetakeButtons() {
    itemMeta.querySelectorAll(".retake-btn").forEach(btn => {
      btn.onclick = async () => {
        const index = Number(btn.dataset.index);
        showStatus(`Retaking image ${index + 1}…`);

        const file = await promptCameraCapture();
        if (!file) return clearStatus();

        const preview = URL.createObjectURL(file);
        setPreviewImageSlot(index, preview);

        const url = await uploadToCloudinary(file);
        currentItem.data.images[index] = url;

        const itemRef = doc(
          db,
          "Shops",
          currentItem.uid,
          "categories",
          currentItem.categoryId,
          "items",
          currentItem.itemId
        );

        await updateDoc(itemRef, {
          images: currentItem.data.images,
          updatedAt: Date.now()
        });

        sendImageForEmbedding(url, index); // ✅ index fixed

        clearStatus();
        renderItemMeta(currentItem.data);
      };
    });
  }

  // -------------------
  // Helpers
  // -------------------
  function promptCameraCapture() {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.capture = "environment";
      input.style.display = "none";

      captureInProgress = true;

      input.onchange = () => {
        captureInProgress = false;
        resolve(input.files?.[0] || null);
        input.remove();
      };

      document.body.appendChild(input);
      input.click();
    });
  }

  function setPreviewImageSlot(index, url) {
    const slot = itemMeta.querySelector(`.image-slot:nth-child(${index + 1})`);
    if (slot) slot.innerHTML = `<img src="${url}" class="item-thumb">`;
  }

  function setPlaceholderMessage(index, text) {
    const slot = itemMeta.querySelector(`.image-slot:nth-child(${index + 1})`);
    if (slot) slot.textContent = text;
  }

  async function uploadToCloudinary(file) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
      { method: "POST", body: fd }
    );

    return (await res.json()).secure_url;
  }

  function showStatus(text) {
    const s = itemMeta.querySelector(".capture-status");
    if (s) s.textContent = text;
  }

  function clearStatus() {
    const s = itemMeta.querySelector(".capture-status");
    if (s) s.textContent = "";
  }

  // -------------------
  // Hide item detail (go back to categories)
  // -------------------
  function hideItemDetail() {
    itemDetail.classList.add("hidden");
    // Show categories overlay again
    overlayContent.classList.remove("hidden");
    document.body.style.overflow = "";
    currentItem = null;
    editMode = false;
    if (editToggleBtn) editToggleBtn.textContent = "Edit";
    
    // Remove the injected close button
    const closeBtn = document.getElementById("item-detail-close-btn");
    if (closeBtn) closeBtn.remove();
  }

  // -------------------
  // Public API
  // -------------------
  window.attachItemDetailHandler = (el, name, uid, categoryId, itemId) => {
    el.onclick = e => {
      e.stopPropagation();
      showItemDetail(name, uid, categoryId, itemId);
    };
  };

  window.hideItemDetail = hideItemDetail;
});