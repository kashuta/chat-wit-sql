import { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { ExecutionStep } from '../components/execution/ProgressIndicator';
import useLogStream from './useLogStream';
import { languageInstructions } from '../config/languageConfig';
import { v4 as uuidv4 } from 'uuid';
import useWebSocketEvents, { WebSocketEvent } from './useWebSocketEvents';
import { detectDataTypes, DataTypeFlags } from '../utils/dataTypeDetector';

type QueryResult = {
  data: Record<string, unknown>;
  explanation: string;
  confidence: number;
  sql?: string;
  visualization?: {
    type: 'table' | 'line' | 'bar' | 'pie';
    data: unknown;
  };
  queryId?: string;
  dataTypes?: DataTypeFlags;
};

type QueryRequest = {
  query: string;
  language: string;
  queryId?: string;
};

type UseQueryExecutionReturn = {
  query: string;
  setQuery: (query: string) => void;
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  executeQuery: () => Promise<void>;
  steps: ExecutionStep[];
  currentStepId: string | undefined;
  logs: any[];
  progress: number;
};

// Define the default execution steps
const DEFAULT_STEPS: ExecutionStep[] = [
  { id: 'analysis', name: 'Analysis', status: 'pending' },
  { id: 'planning', name: 'Planning', status: 'pending' },
  { id: 'execution', name: 'Execution', status: 'pending' },
  { id: 'results', name: 'Results', status: 'pending' }
];

const useQueryExecution = (): UseQueryExecutionReturn => {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>(DEFAULT_STEPS);
  const [currentStepId, setCurrentStepId] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);
  const [queryId, setQueryId] = useState<string | undefined>();

  // Get log stream using our custom hook
  const { logs } = useLogStream({ queryId, autoConnect: true });

  // Setup WebSocket connection for real-time updates
  const { connected, on } = useWebSocketEvents(queryId);

  // Register event handlers for WebSocket events
  useEffect(() => {
    if (!connected) return;

    // Handle phase change events
    const phaseUnsubscribe = on('PHASE_CHANGE', (event: WebSocketEvent) => {
      const { phase } = event.payload;
      
      // Update active step based on phase
      if (phase && steps.some(step => step.id === phase)) {
        setActiveStep(phase);
      }
    });
    
    // Handle progress events
    const progressUnsubscribe = on('PROGRESS', (event: WebSocketEvent) => {
      const { step, total, description } = event.payload;
      
      if (step !== undefined && total !== undefined) {
        // Update progress state
        const progressPercentage = Math.floor((step / total) * 100);
        setProgress(progressPercentage);
        
        // Update current step details if applicable
        if (currentStepId) {
          setSteps(prevSteps => 
            prevSteps.map(step => {
              if (step.id === currentStepId) {
                return {
                  ...step,
                  details: {
                    subStep: description,
                    progress: progressPercentage
                  }
                };
              }
              return step;
            })
          );
        }
      }
    });
    
    // Clean up event handlers on unmount
    return () => {
      phaseUnsubscribe();
      progressUnsubscribe();
    };
  }, [connected, currentStepId, steps, on]);

  // Update execution step status
  const updateStepStatus = (stepId: string, status: ExecutionStep['status'], message?: string) => {
    setSteps(prevSteps => 
      prevSteps.map(step => {
        if (step.id === stepId) {
          return { 
            ...step, 
            status, 
            message,
            ...(status === 'running' && { startTime: Date.now() }),
            ...(status === 'completed' && { endTime: Date.now() })
          };
        }
        return step;
      })
    );
  };

  // Set the current active step
  const setActiveStep = (stepId: string) => {
    setCurrentStepId(stepId);
    
    // Mark this step as running
    updateStepStatus(stepId, 'running');
    
    // Update progress based on step position
    const stepIndex = steps.findIndex(step => step.id === stepId);
    if (stepIndex >= 0) {
      // Calculate progress as percentage (add 1 to make the first step show some progress)
      const newProgress = Math.floor(((stepIndex + 1) / steps.length) * 100);
      setProgress(newProgress);
    }
  };

  // Execute the query
  const executeQuery = async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(0);
    
    // Reset steps to default state
    setSteps(DEFAULT_STEPS);
    
    // Generate query ID
    const newQueryId = uuidv4();
    setQueryId(newQueryId);
    
    try {
      // Start with analysis step
      setActiveStep('analysis');
      
      let modifiedQuery = query;
      if (language === 'ru' && languageInstructions.ru) {
        modifiedQuery = `${query} ${languageInstructions.ru}`;
      }

      const queryRequest: QueryRequest = {
        query: modifiedQuery,
        language,
        queryId: newQueryId
      };

      // Simulate API analysis phase (in a real app, the backend would update progress)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mark analysis as complete and move to planning
      updateStepStatus('analysis', 'completed');
      setActiveStep('planning');
      
      // Simulate planning phase
      await new Promise(resolve => setTimeout(resolve, 700));
      
      // Mark planning as complete and move to execution
      updateStepStatus('planning', 'completed');
      setActiveStep('execution');

      // Actually execute the query
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryRequest),
      });
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }
      
      // Mark execution as complete and move to results
      updateStepStatus('execution', 'completed');
      setActiveStep('results');
      
      const data = await response.json();
      
      // Detect data types
      const dataTypes = detectDataTypes(data.data || {});
      data.dataTypes = dataTypes;
      
      setResult(data);
      
      // Mark results as complete
      updateStepStatus('results', 'completed');
      setProgress(100);
    } catch (err) {
      // Mark current step as error
      if (currentStepId) {
        updateStepStatus(currentStepId, 'error', (err as Error).message);
      }
      
      setError((err as Error).message || t.errorDefault);
    } finally {
      setLoading(false);
    }
  };

  return {
    query,
    setQuery,
    result,
    loading,
    error,
    executeQuery,
    steps,
    currentStepId,
    logs,
    progress
  };
};

export default useQueryExecution; 