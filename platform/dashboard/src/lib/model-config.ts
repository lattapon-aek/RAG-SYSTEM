export function envFirst(keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined && value !== '') return value
  }
  return fallback
}

function llmDefault(provider: string) {
  switch (provider.toLowerCase()) {
    case 'openai':
      return 'gpt-4o-mini'
    case 'anthropic':
      return 'claude-3-haiku-20240307'
    case 'typhoon':
    case 'opentyphoon':
      return envFirst(['TYPHOON_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], 'typhoon-v2.1-12b-instruct')
    case 'azure':
      return envFirst(['AZURE_OPENAI_DEPLOYMENT', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], 'gpt-4o-mini')
    default:
      return 'qwen3:0.6b'
  }
}

function embeddingDefault(provider: string) {
  switch (provider.toLowerCase()) {
    case 'openai':
      return 'text-embedding-ada-002'
    case 'huggingface':
      return 'sentence-transformers/all-MiniLM-L6-v2'
    case 'cohere':
      return 'embed-english-v3.0'
    default:
      return 'bge-m3'
  }
}

export function modelConfig() {
  const llmProvider = envFirst(['LLM_PROVIDER'], 'ollama')
  const utilityLlmProvider = envFirst(['UTILITY_LLM_PROVIDER'], llmProvider)
  const generationLlmProvider = envFirst(['GENERATION_LLM_PROVIDER'], llmProvider)
  const graphLlmProvider = envFirst(['GRAPH_LLM_PROVIDER'], utilityLlmProvider)
  const gapDraftLlmProvider = envFirst(['GAP_DRAFT_LLM_PROVIDER'], generationLlmProvider)
  const embeddingProvider = envFirst(['EMBEDDING_PROVIDER'], 'ollama')
  const llmFallback = llmDefault(llmProvider)
  const utilityFallback = llmDefault(utilityLlmProvider)
  const generationFallback = llmDefault(generationLlmProvider)
  const graphFallback = llmDefault(graphLlmProvider)
  const gapDraftFallback = llmDefault(gapDraftLlmProvider)
  const embeddingFallback = embeddingDefault(embeddingProvider)
  return {
    llmProvider,
    utilityLlmProvider,
    generationLlmProvider,
    graphLlmProvider,
    gapDraftLlmProvider,
    embeddingProvider,
    llmModel: llmFallback,
    utilityLlmModel: envFirst(['UTILITY_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], utilityFallback),
    generationLlmModel: envFirst(['GENERATION_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], generationFallback),
    graphLlmModel: envFirst(['GRAPH_LLM_MODEL', 'UTILITY_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], graphFallback),
    gapDraftLlmModel: envFirst(['GAP_DRAFT_LLM_MODEL', 'GENERATION_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], gapDraftFallback),
    embeddingModel: envFirst(['EMBEDDING_MODEL', 'OLLAMA_EMBEDDING_MODEL'], embeddingFallback),
    ollamaBaseUrl: envFirst(['OLLAMA_BASE_URL'], 'http://ollama:11434'),
    typhoonBaseUrl: envFirst(['TYPHOON_BASE_URL'], 'https://api.opentyphoon.ai/v1'),
    azureDeployment: envFirst(['AZURE_OPENAI_DEPLOYMENT', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], ''),
  }
}
