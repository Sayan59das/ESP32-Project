// Names for the generated OpenAPI types. Nothing here is written by hand: run `make types`
// after changing a pydantic model and these follow.
import type { components } from './api-types';

type Schemas = components['schemas'];

export type State = Schemas['State'];
export type Event = Schemas['Event'];
export type Link = Schemas['Link'];
export type Counts = Schemas['Counts'];
export type ItemCount = Schemas['ItemCount'];
export type Run = Schemas['Run'];
export type Health = Schemas['Health'];

export type StoredBin = Event['bin'];
export type SourceName = Run['source'];
