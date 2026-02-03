import { createStore, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import createRootReducer from '../reducers';
import { Store, StoreState } from '../reducers/types';

function configureStore(initialState?: StoreState): Store {
  const rootReducer = createRootReducer();
  const enhancer = applyMiddleware(thunk);
  return createStore(rootReducer, enhancer);
}

export default { configureStore };
