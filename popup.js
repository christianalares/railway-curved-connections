const checkbox = document.getElementById("enabled");
chrome.storage.local.get({enabled: true}, (settings) => {
  checkbox.checked = settings.enabled !== false;
});
checkbox.addEventListener("change", () => {
  chrome.storage.local.set({enabled: checkbox.checked});
});
