import { NextResponse } from 'next/server'
import { modelConfig } from '@/lib/model-config'

/**
 * Returns a safe subset of server-side env vars for the pipeline diagram.
 * Only non-secret configuration keys are exposed.
 */
export async function GET() {
  const cfg = modelConfig()
  return NextResponse.json({
    // Provider routing
    llmProvider: cfg.llmProvider,
    utilityLlmProvider: cfg.utilityLlmProvider,
    queryRewriteLlmProvider: cfg.queryRewriteLlmProvider,
    hydeLlmProvider: cfg.hydeLlmProvider,
    queryDecomposerLlmProvider: cfg.queryDecomposerLlmProvider,
    querySeedLlmProvider: cfg.querySeedLlmProvider,
    compressionLlmProvider: cfg.compressionLlmProvider,
    graphLlmProvider: cfg.graphLlmProvider,
    gapDraftLlmProvider: cfg.gapDraftLlmProvider,
    embeddingProvider: cfg.embeddingProvider,
    // LLM models
    llmModel: cfg.llmModel,
    utilityLlmModel: cfg.utilityLlmModel,
    queryRewriteLlmModel: cfg.queryRewriteLlmModel,
    hydeLlmModel: cfg.hydeLlmModel,
    queryDecomposerLlmModel: cfg.queryDecomposerLlmModel,
    querySeedLlmModel: cfg.querySeedLlmModel,
    compressionLlmModel: cfg.compressionLlmModel,
    graphLlmModel: cfg.graphLlmModel,
    gapDraftLlmModel: cfg.gapDraftLlmModel,
    compressionLlmSystemPrompt: cfg.compressionLlmSystemPrompt,
    embeddingModel: cfg.embeddingModel,
    ollamaBaseUrl: cfg.ollamaBaseUrl,
    typhoonBaseUrl: cfg.typhoonBaseUrl,
    // Cache
    semanticCacheThreshold: process.env.SEMANTIC_CACHE_THRESHOLD ?? '0.92',
    // Memory
    enableMemory:   process.env.ENABLE_MEMORY   ?? 'false',
    memoryBackend:  process.env.MEMORY_BACKEND  ?? 'composite',
    // Vector store
    vectorStore: process.env.VECTOR_STORE ?? 'chromadb',
    // Graph
    enableGraph:           process.env.ENABLE_GRAPH            ?? 'true',
    graphExtractorBackend: process.env.GRAPH_EXTRACTOR_BACKEND ?? 'llm',
    graphQuerySeedSystemPrompt: process.env.GRAPH_QUERY_SEED_SYSTEM_PROMPT ?? '',
    graphQuerySeedMaxTokens: process.env.GRAPH_QUERY_SEED_MAX_TOKENS ?? '512',
    // Reranker
    rerankerBackend: process.env.RERANKER_BACKEND ?? 'noop',
    rerankerLlmUrl: process.env.LLM_RERANKER_URL ?? '',
    rerankerLlmModel: process.env.LLM_RERANKER_MODEL ?? '',
    // Context / compression
    compressor:                    process.env.COMPRESSOR                     ?? 'noop',
    contextCompressionThreshold:   process.env.CONTEXT_COMPRESSION_THRESHOLD  ?? '0.1',
    contextDedupOverlapThreshold:  process.env.CONTEXT_DEDUP_OVERLAP_THRESHOLD ?? '0.8',
    // Knowledge gap
    knowledgeGapThreshold: process.env.KNOWLEDGE_GAP_THRESHOLD ?? '0.6',
  })
}
