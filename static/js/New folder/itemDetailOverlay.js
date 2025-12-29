// itemDetailOverlay.js
// Polished item capture with clear feedback, persistent CTA, and smooth UX
// FIX: always send image_index to backend for embedding

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const CLOUDINARY_CLOUD = "decckqobb";
const CLOUDINARY_UPLOAD_PRESET = "Superkeeper";
const FLASK_BACKEND_URL = window.location.origin;

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("overlay");
  const overlayContent = document.querySelector(".overlay-content");
  const itemDetail = document.getElementById("item-detail");
  const itemNameEl = document.getElementById("item-name");
  const closeItemDetail = document.getElementById("close-item-detail");
  const itemMeta = document.getElementById("item-meta");
  const editToggleBtn = document.getElementById("edit-toggle-btn");

  let wasCategoriesOpen = false;
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
  // Edit / Save toggle
  // -------------------
  if (editToggleBtn) {
    editToggleBtn.addEventListener("click", () => {
      editMode = !editMode;
      editToggleBtn.textContent = editMode ? "Save" : "Edit";
      renderItemMeta(currentItem?.data);
    });
  }

  // -------------------
  // Close button
  // -------------------
  if (closeItemDetail) {
    closeItemDetail.addEventListener("click", (e) => {
      e.stopPropagation();
      if (captureInProgress) return alert("Finish image capture first.");
      hideItemDetail();
    });
  }

  // -------------------
  // Show item detail
  // -------------------
  async function showItemDetail(name, uid, categoryId, itemId) {
    editMode = false;
    if (editToggleBtn) editToggleBtn.textContent = "Edit";

    wasCategoriesOpen =
      !!overlay && !overlay.classList.contains("hidden") &&
      !!overlayContent && !overlayContent.classList.contains("hidden");

    overlay.classList.remove("hidden");
    overlayContent.classList.add("hidden");
    itemDetail.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    if (itemNameEl) itemNameEl.textContent = name ?? "";

    const itemRef = doc(db, "Shops", uid, "categories", categoryId, "items", itemId);
    const snap = await getDoc(itemRef);
    const data = snap.exists() ? snap.data() : { name, images: [] };

    currentItem = { uid, categoryId, itemId, name, data };
    renderItemMeta(data);

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

    await setDoc(itemRef, { ...data, images, createdAt: Date.now() }, { merge: true });
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
  // Render item meta
  // -------------------
  function renderItemMeta(data = {}) {
    const imgs = data.images || [];

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

    itemMeta.innerHTML = `
      <div class="item-images">${imgHtml}</div>
      <div class="item-prices">
        <p>Buy Price: ${data.buyPrice ?? "-"}</p>
        <p>Sell Price: ${data.sellPrice ?? "-"}</p>
      </div>
      <div class="capture-actions"></div>
      <div class="capture-status"></div>
    `;

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
  // Public API
  // -------------------
  window.attachItemDetailHandler = (el, name, uid, categoryId, itemId) => {
    el.onclick = e => {
      e.stopPropagation();
      showItemDetail(name, uid, categoryId, itemId);
    };
  };

  function hideItemDetail() {
    itemDetail.classList.add("hidden");
    overlay.classList.toggle("hidden", !wasCategoriesOpen);
    overlayContent.classList.toggle("hidden", !wasCategoriesOpen);
    document.body.style.overflow = "";
  }

  window.hideItemDetail = hideItemDetail;
});
