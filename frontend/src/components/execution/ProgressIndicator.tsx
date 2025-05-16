import React, { useEffect, useState } from 'react';

// Add step details type
export type StepDetails = {
  subStep?: string;
  progress?: number;
  info?: string;
};

export type ExecutionStep = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
  message?: string;
  details?: StepDetails;
};

type ProgressIndicatorProps = {
  steps: ExecutionStep[];
  currentStepId?: string;
};

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ steps, currentStepId }) => {
  const [progress, setProgress] = useState<number>(0);
  
  // Calculate overall progress based on step status
  useEffect(() => {
    if (!steps.length) return;
    
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const totalSteps = steps.length;
    
    // If current step is running, add partial progress
    let runningProgress = 0;
    if (currentStepId) {
      const currentStep = steps.find(s => s.id === currentStepId);
      if (currentStep?.status === 'running' && currentStep?.details?.progress) {
        runningProgress = (currentStep.details.progress / 100) / totalSteps;
      }
    }
    
    const newProgress = ((completedSteps / totalSteps) + runningProgress) * 100;
    setProgress(Math.min(newProgress, 99)); // Cap at 99% until complete
  }, [steps, currentStepId]);
  
  // Calculate execution times and percentages
  const calculateTime = (start?: number, end?: number): string => {
    if (!start) return '-';
    const endTime = end || Date.now();
    const duration = endTime - start;
    
    if (duration < 1000) {
      return `${duration}ms`;
    }
    
    return `${(duration / 1000).toFixed(2)}s`;
  };

  const getStepClass = (step: ExecutionStep): string => {
    switch (step.status) {
      case 'running':
        return 'step-running';
      case 'completed':
        return 'step-completed';
      case 'error':
        return 'step-error';
      default:
        return 'step-pending';
    }
  };

  return (
    <div className="execution-progress">
      <h3 className="progress-title">Execution Progress</h3>
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${progress}%` }} 
        />
      </div>
      <div className="step-indicators">
        {steps.map((step, index) => (
          <div 
            key={step.id} 
            className={`execution-step ${getStepClass(step)} ${step.id === currentStepId ? 'current-step' : ''}`}
          >
            <div className="step-number">{index + 1}</div>
            <div className="step-info">
              <div className="step-name">{step.name}</div>
              <div className="step-status">
                {step.status === 'running' && 'Running...'}
                {step.status === 'completed' && 'Completed'}
                {step.status === 'error' && 'Error'}
                {step.status === 'pending' && 'Pending'}
                {(step.status === 'completed' || step.status === 'running') && step.startTime && (
                  <span className="step-time">
                    {calculateTime(step.startTime, step.endTime)}
                  </span>
                )}
              </div>
              {step.message && <div className="step-message">{step.message}</div>}
              {step.id === currentStepId && step.details?.subStep && (
                <div className="substep-info">
                  <div className="substep-label">Current action:</div>
                  <div className="substep-value">{step.details.subStep}</div>
                </div>
              )}
            </div>
            {index < steps.length - 1 && <div className="step-connector"></div>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProgressIndicator; 