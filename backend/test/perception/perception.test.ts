import { expect } from 'chai';
import sinon from 'sinon';
import * as perceptionModule from '../../packages/perception/index';
import * as llmModule from '../../packages/common/llm';
import { DatabaseService } from '../../packages/common/types';

// Для тестирования приватных функций через any
const perception = perceptionModule as any;

describe('Perception Module', () => {
  let modelStub: sinon.SinonStub;
  
  beforeEach(() => {
    // Мокаем LLM модель для тестирования
    modelStub = sinon.stub();
    sinon.stub(llmModule, 'getOpenAIModel').returns({
      invoke: modelStub
    } as any);
  });
  
  afterEach(() => {
    sinon.restore();
  });
  
  describe('validateAndEnrichRequiredServices', () => {
    it('should add both financial-history and bets-history for queries mentioning deposits and bets', () => {
      const services = perception.validateAndEnrichRequiredServices(
        ['financial-history'],
        'compare deposits and bets',
        'show me deposits and bets for user 1',
        { userId: 1 }
      );
      
      expect(services).to.include('financial-history');
      expect(services).to.include('bets-history');
      expect(services.length).to.be.at.least(2);
    });
    
    it('should add user-activities when user_id is present in entities', () => {
      const services = perception.validateAndEnrichRequiredServices(
        ['financial-history'],
        'get deposits',
        'show deposits for user 1',
        { userId: 1 }
      );
      
      expect(services).to.include('financial-history');
      expect(services).to.include('user-activities');
    });
    
    it('should add wallet and user-activities for balance and activity queries', () => {
      const services = perception.validateAndEnrichRequiredServices(
        ['wallet'],
        'check balance and activity',
        'show me balance and activity history',
        null
      );
      
      expect(services).to.include('wallet');
      expect(services).to.include('user-activities');
    });
    
    it('should return at least one service even if input is empty', () => {
      const services = perception.validateAndEnrichRequiredServices(
        [],
        'unknown intent',
        'random query',
        null
      );
      
      expect(services.length).to.be.gt(0);
    });
    
    it('should enrich services for Russian language queries', () => {
      const services = perception.validateAndEnrichRequiredServices(
        ['wallet'],
        'проверка баланса и активности',
        'покажи мне баланс и историю активности',
        null
      );
      
      expect(services).to.include('wallet');
      expect(services).to.include('user-activities');
    });
  });
  
  describe('inferServicesFromQuery', () => {
    it('should identify financial-history from deposit-related keywords', () => {
      const services = perception.inferServicesFromQuery('show me all deposits');
      expect(services).to.include('financial-history');
    });
    
    it('should identify bets-history from bet-related keywords', () => {
      const services = perception.inferServicesFromQuery('how many bets did I place');
      expect(services).to.include('bets-history');
    });
    
    it('should identify user-activities from activity-related keywords', () => {
      const services = perception.inferServicesFromQuery('show my login history');
      expect(services).to.include('user-activities');
    });
    
    it('should identify wallet from balance-related keywords', () => {
      const services = perception.inferServicesFromQuery('what is my current balance');
      expect(services).to.include('wallet');
    });
    
    it('should identify multiple services from complex queries', () => {
      const services = perception.inferServicesFromQuery('show deposits and bets for last week');
      expect(services).to.include('financial-history');
      expect(services).to.include('bets-history');
    });
    
    it('should work with Russian language queries', () => {
      const services = perception.inferServicesFromQuery('покажи мои депозиты и ставки');
      expect(services).to.include('financial-history');
      expect(services).to.include('bets-history');
    });
  });
  
  describe('analyzeQuery', () => {
    it('should return enhanced requiredServices', async () => {
      // Настраиваем мок для LLM, возвращающий только один сервис
      modelStub.resolves({
        content: JSON.stringify({
          intent: 'get deposit and bet info',
          confidence: 0.9,
          entities: { userId: 1 },
          requiredServices: ['financial-history'],
          sqlQuery: 'SELECT * FROM transactions'
        })
      });
      
      const result = await perceptionModule.analyzeQuery('show deposits and bets for user 1');
      
      // Проверяем, что были добавлены все необходимые сервисы
      expect(result.requiredServices).to.include('financial-history');
      expect(result.requiredServices).to.include('bets-history');
      expect(result.confidence).to.equal(0.9);
    });
    
    it('should handle empty requiredServices from LLM', async () => {
      modelStub.resolves({
        content: JSON.stringify({
          intent: 'unknown intent',
          confidence: 0.5,
          entities: null,
          requiredServices: [],
          sqlQuery: null
        })
      });
      
      const result = await perceptionModule.analyzeQuery('what is my account info');
      
      // Проверяем, что были добавлены сервисы на основе эвристики
      expect(result.requiredServices.length).to.be.gt(0);
    });
    
    it('should handle Russian queries', async () => {
      modelStub.resolves({
        content: JSON.stringify({
          intent: 'получить информацию о депозитах',
          confidence: 0.9,
          entities: null,
          requiredServices: ['financial-history'],
          sqlQuery: 'SELECT * FROM transactions'
        })
      });
      
      const result = await perceptionModule.analyzeQuery('покажи мои депозиты и ставки');
      
      expect(result.requiredServices).to.include('financial-history');
      expect(result.requiredServices).to.include('bets-history');
    });
  });
}); 