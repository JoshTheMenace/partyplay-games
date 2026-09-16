import { COAST_DESIGN } from './courses/coast';
import { CANYON_DESIGN } from './courses/canyon';
import { MIDNIGHT_DESIGN } from './courses/midnight';
import { RAINBOW_DESIGN } from './courses/rainbow';
import type { CourseDesign } from './courses/spec';
import type { TrackId } from './types';
export const COURSE_DESIGNS:Record<TrackId,CourseDesign>={coast:COAST_DESIGN,canyon:CANYON_DESIGN,midnight:MIDNIGHT_DESIGN,rainbow:RAINBOW_DESIGN};
