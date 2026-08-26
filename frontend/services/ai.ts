import { GoogleGenAI } from '@google/genai';
import { Attachment } from '../types.ts';

// Initialize with the environment variable as strictly required by guidelines.
// The index.html mocks this for the browser environment based on localStorage.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

const MODEL_NAME = 'gemini-2.5-flash';

export const generateContentStream = async (
  prompt: string,
  attachments: Attachment[],
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  try {
    const parts: any[] = [];
    
    // Add images if any
    attachments.forEach(att => {
      if (att.type.startsWith('image/')) {
        // Extract base64 data without the data:image/xxx;base64, prefix
        const base64Data = att.data.split(',')[1];
        if (base64Data) {
           parts.push({
            inlineData: {
              mimeType: att.type,
              data: base64Data
            }
          });
        }
      }
    });

    parts.push({ text: prompt });

    const responseStream = await ai.models.generateContentStream({
      model: MODEL_NAME,
      contents: {
        role: 'user',
        parts: parts
      }
    });

    let fullText = '';
    for await (const chunk of responseStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      if (chunk.text) {
        fullText += chunk.text;
        onChunk(fullText);
      }
    }
    return fullText;
  } catch (error: any) {
    if (error.message === 'Aborted') {
      console.log('Stream aborted by user');
      throw error;
    }
    console.error('AI Generation Error:', error);
    throw new Error(error.message || 'Failed to generate content');
  }
};

export const generateContent = async (
  prompt: string,
  attachments: Attachment[] = []
): Promise<string> => {
  try {
    const parts: any[] = [];
    attachments.forEach(att => {
      if (att.type.startsWith('image/')) {
        const base64Data = att.data.split(',')[1];
        if (base64Data) {
           parts.push({
            inlineData: {
              mimeType: att.type,
              data: base64Data
            }
          });
        }
      }
    });
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        role: 'user',
        parts: parts
      }
    });
    return response.text || '';
  } catch (error: any) {
    console.error('AI Generation Error:', error);
    throw new Error(error.message || 'Failed to generate content');
  }
};
