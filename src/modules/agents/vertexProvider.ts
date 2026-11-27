/**
 * Vertex AI provider via Firebase AI Logic (`firebase/ai` + `VertexAIBackend`).
 * No Vertex AI API key or Service Account is stored in GitHub or the browser bundle;
 * requests are authorized through Firebase + owner Google Sign-In.
 */
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../../config/runtimeConfig.js';
import {
  DEFAULT_VERTEX_MODEL,
  RETIRED_VERTEX_MODELS,
  resolveVertexModelId,
} from '../../domain/ai/modelRegistry';

export { DEFAULT_VERTEX_MODEL, RETIRED_VERTEX_MODELS, resolveVertexModelId };

export interface VertexCallParams {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  location?: string;
}

export async function runVertexAI({
  model = DEFAULT_VERTEX_MODEL,
  system,
  prompt,
  temperature = 0.3,
  maxTokens,
  location = 'global',
}: VertexCallParams): Promise<string> {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) {
    throw new Error('Vertex AI (Firebase AI Logic) yêu cầu chế độ firebase_auth và đã đăng nhập Gmail chủ sở hữu.');
  }
  const [{ initializeApp, getApps }, { getAI, getGenerativeModel, VertexAIBackend }] = await Promise.all([
    import('firebase/app'),
    import('firebase/ai'),
  ]);
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new VertexAIBackend(location) });
  const generativeModel = getGenerativeModel(ai, {
    model: resolveVertexModelId(model),
    systemInstruction: system,
    generationConfig: {
      temperature,
      ...(typeof maxTokens === 'number' && maxTokens > 0 ? { maxOutputTokens: maxTokens } : {}),
    },
  });
  const result = await generativeModel.generateContent(prompt);
  return result.response.text() || 'Vertex AI không trả về nội dung.';
}
