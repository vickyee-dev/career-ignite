'use strict';

const { f } = require('../lib/validate');
const { validation } = require('../lib/errors');
const { crudRoutes } = require('./crud');

const active = f.boolean({ default: true });
const text = (o) => f.string({ required: true, ...o });

const departments = crudRoutes({
  path: 'departments',
  model: 'department',
  label: 'Department',
  uniqueBy: 'name',
  search: ['name', 'department_head', 'description'],
  sortable: ['name', 'department_head', 'created_at'],
  defaultSort: 'name',
  schema: {
    name: text({ max: 255 }),
    department_head: text({ max: 150 }),
    description: f.string({ nullable: true }),
    is_active: active,
  },
});

const opportunityTypes = crudRoutes({
  path: 'opportunity-types',
  model: 'opportunityType',
  label: 'Opportunity type',
  uniqueBy: 'type',
  search: ['type', 'description'],
  sortable: ['type', 'created_at'],
  defaultSort: 'type',
  schema: { type: text({ max: 255 }), description: text(), is_active: active },
});

const compensationTypes = crudRoutes({
  path: 'compensation-types',
  model: 'compensationType',
  label: 'Compensation type',
  uniqueBy: 'type',
  search: ['type', 'description'],
  sortable: ['type', 'created_at'],
  defaultSort: 'type',
  schema: { type: text({ max: 255 }), description: text(), is_active: active },
});

const cohorts = crudRoutes({
  path: 'cohorts',
  model: 'cohort',
  label: 'Cohort',
  uniqueBy: 'name',
  search: ['name', 'code_name', 'president'],
  sortable: ['name', 'start_date', 'end_date', 'created_at'],
  defaultSort: '-start_date',
  schema: {
    name: text({ max: 150 }),
    code_name: text({ max: 150 }),
    president: text({ max: 150 }),
    start_date: f.date({ required: true }),
    end_date: f.date({ required: true }),
    is_active: active,
  },
  refine(c) {
    if (c.end_date <= c.start_date) throw validation({ end_date: 'must be after start_date' });
  },
});

const titles = crudRoutes({
  path: 'titles',
  model: 'title',
  label: 'Title',
  uniqueBy: 'name',
  search: ['name', 'description'],
  sortable: ['name', 'created_at'],
  defaultSort: 'name',
  schema: { name: text({ max: 255 }), description: text(), is_active: active },
});

module.exports = { routes: [...departments, ...opportunityTypes, ...compensationTypes, ...cohorts, ...titles] };
