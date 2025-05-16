export const MESSAGE_TEMPLATES = {
  // Debug messages
  debug: {
    systemPromptFirst100: 'System prompt (first 100 characters): {text}...',
    promptCreated: 'Prompt created, formatting with query',
    callingLLM: 'Calling LLM for perception analysis',
    variableFound: 'Variable found in template: {varName}',
    chatTemplateCreation: 'Creating chat template with variables: {variables}',
    creatingBackupTemplate: 'Creating simple backup template',
    errorStack: 'Error stack: {stack}'
  },

  // Error messages
  error: {
    openAIKeyRequired: 'OPENAI_API_KEY environment variable is required',
    unexpectedLLMResponse: 'Unexpected LLM response format - not a string',
    promptCreationError: 'Error creating prompt template:',
    errorMessage: 'Error message: {message}'
  },

  // Info messages
  info: {
    initializingModel: 'Initializing OpenAI model: {model}, temperature: {temperature}',
    queryAnalyzed: 'Query analyzed with intent: {intent}, confidence: {confidence}',
    enhancedServices: 'Enhanced required services: {services}'
  }
}; 