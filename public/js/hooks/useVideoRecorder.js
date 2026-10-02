import {
  clearSessionChunks,
  getSessionChunks,
  saveChunk,
} from "../lib/indexedDbChunks.js";

const DEFAULT_TIMESLICE = 5000;

function getSupportedMimeType() {
  const preferred = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return preferred.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function useVideoRecorder(options = {}) {
  const timeslice = options.timeslice || DEFAULT_TIMESLICE;

  let mediaStream = null;
  let mediaRecorder = null;
  let activeSessionId = null;
  let chunkIndex = 0;
  let startedAt = null;
  let stoppedAt = null;
  let activeMimeType = "video/webm";
  const pendingWrites = new Set();

  async function requestPermissions() {
    if (mediaStream) {
      return mediaStream;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    return mediaStream;
  }

  function attachPreview(videoElement) {
    if (!videoElement || !mediaStream) {
      return;
    }

    videoElement.srcObject = mediaStream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.autoplay = true;

    const playPromise = videoElement.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }

  async function startRecording(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required to start recording");
    }

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      throw new Error("Recording already in progress");
    }

    await requestPermissions();

    activeSessionId = sessionId;
    chunkIndex = 0;
    startedAt = Date.now();
    stoppedAt = null;

    await clearSessionChunks(activeSessionId);

    const mimeType = getSupportedMimeType();
    if (mimeType) {
      activeMimeType = mimeType;
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    } else {
      mediaRecorder = new MediaRecorder(mediaStream);
      activeMimeType = mediaRecorder.mimeType || "video/webm";
    }

    mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) {
        return;
      }

      const writePromise = saveChunk({
        sessionId: activeSessionId,
        chunkIndex,
        blob: event.data,
        createdAt: Date.now(),
      }).finally(() => pendingWrites.delete(writePromise));

      pendingWrites.add(writePromise);
      chunkIndex += 1;
    };

    mediaRecorder.start(timeslice);

    return {
      startedAt,
      mimeType: activeMimeType,
    };
  }

  async function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      stoppedAt = Date.now();
      return {
        startedAt,
        stoppedAt,
        durationMs: Math.max(0, (stoppedAt || 0) - (startedAt || 0)),
        mimeType: activeMimeType,
      };
    }

    await new Promise((resolve, reject) => {
      mediaRecorder.onstop = () => resolve();
      mediaRecorder.onerror = () =>
        reject(mediaRecorder.error || new Error("MediaRecorder error"));
      mediaRecorder.stop();
    });

    await Promise.allSettled([...pendingWrites]);

    stoppedAt = Date.now();

    return {
      startedAt,
      stoppedAt,
      durationMs: Math.max(0, (stoppedAt || 0) - (startedAt || 0)),
      mimeType: activeMimeType,
    };
  }

  async function getMergedBlob() {
    if (!activeSessionId) {
      throw new Error("No recording session exists");
    }

    const chunks = await getSessionChunks(activeSessionId);
    const chunkBlobs = chunks.map((item) => item.blob);

    return new Blob(chunkBlobs, {
      type: activeMimeType || "video/webm",
    });
  }

  async function uploadMergedRecording({ uploadUrl, stage, durationMs }) {
    const mergedBlob = await getMergedBlob();
    const fileName = `${activeSessionId}.webm`;

    const formData = new FormData();
    formData.append("video", mergedBlob, fileName);
    formData.append("stage", String(stage));
    formData.append("durationMs", String(durationMs));
    formData.append("mimeType", activeMimeType || "video/webm");

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Upload failed");
    }

    return data;
  }

  async function clearCurrentSession() {
    if (!activeSessionId) {
      return;
    }

    await clearSessionChunks(activeSessionId);
  }

  function destroy() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function getSessionId() {
    return activeSessionId;
  }

  function getStream() {
    return mediaStream;
  }

  return {
    requestPermissions,
    attachPreview,
    startRecording,
    stopRecording,
    getMergedBlob,
    uploadMergedRecording,
    clearCurrentSession,
    destroy,
    getSessionId,
    getStream,
  };
}
