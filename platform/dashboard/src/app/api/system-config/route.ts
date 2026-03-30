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
    generationLlmProvider: cfg.generationLlmProvider,
    graphLlmProvider: cfg.graphLlmProvider,
    gapDraftLlmProvider: cfg.gapDraftLlmProvider,
    embeddingProvider: cfg.embeddingProvider,
    // LLM models
    llmModel: cfg.llmModel,
    utilityLlmModel: cfg.utilityLlmModel,
    generationLlmModel: cfg.generationLlmModel,
    graphLlmModel: cfg.graphLlmModel,
    gapDraftLlmModel: cfg.gapDraftLlmModel,
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
    graphExtractorBackend: process.env.GRAPH_EXTRACTOR_BACKEND ?? 'spacy',
    // Reranker
    rerankerBackend: process.env.RERANKER_BACKEND ?? 'noop',
    // Context / compression
    compressor:                    process.env.COMPRESSOR                     ?? 'noop',
    contextCompressionThreshold:   process.env.CONTEXT_COMPRESSION_THRESHOLD  ?? '0.1',
    contextDedupOverlapThreshold:  process.env.CONTEXT_DEDUP_OVERLAP_THRESHOLD ?? '0.8',
    // Knowledge gap
    knowledgeGapThreshold: process.env.KNOWLEDGE_GAP_THRESHOLD ?? '0.6',
  })
}
