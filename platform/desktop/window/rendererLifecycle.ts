type RendererUnavailableListener = () => void

const rendererUnavailableListeners = new Set<RendererUnavailableListener>()

export function registerRendererUnavailableListener(listener: RendererUnavailableListener): () => void {
  rendererUnavailableListeners.add(listener)
  return () => {
    rendererUnavailableListeners.delete(listener)
  }
}

export function notifyRendererUnavailable(): void {
  for (const listener of rendererUnavailableListeners) {
    try {
      listener()
    } catch {
      // Ignore product cleanup failures during renderer reload.
    }
  }
}

export function resetRendererUnavailableListenersForTests(): void {
  rendererUnavailableListeners.clear()
}
