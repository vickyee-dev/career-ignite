'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { f, parse } = require('../lib/validate');
const { badRequest, notFound, validation } = require('../lib/errors');
const { pagination, pageMeta, flag, idParam } = require('../lib/query');
const { ok, created, noContent, sendFile } = require('../core/response');
const { isAdmin, actor, assertOwnerOrAdmin } = require('../core/auth');

// Allowed uploads. Each type is verified by its magic bytes, not just by file name.
const TYPES = {
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [0x50, 0x4b, 0x03, 0x04] },
  doc: { mime: 'application/msword', magic: [0xd0, 0xcf, 0x11, 0xe0] },
};

const uploadSchema = {
  name: f.string({ required: true, max: 255 }),
  description: f.string({ max: 5000, min: 0, default: '' }),
  filename: f.string({ required: true, max: 255 }),
};

/** Strip any directory part and control characters from a client-supplied file name. */
function sanitizeFileName(name) {
  return path
    .basename(name.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
}

const toApi = ({ file_path, ...doc }) => ({ ...doc, download_url: `/api/documents/${doc.id}/download` });

async function loadAccessible(db, user, id) {
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc || (!doc.is_active && !isAdmin(user))) throw notFound('Document not found');
  assertOwnerOrAdmin(user, doc.user_id);
  return doc;
}

const routes = [
  {
    // Raw-body upload:  POST /api/documents?name=CV&filename=cv.pdf   (body = file bytes)
    method: 'POST',
    path: '/api/documents',
    auth: 'user',
    body: 'raw',
    bodyLimit: (config) => config.maxUploadBytes,
    async handler({ db, config, user, query, body }) {
      const meta = parse(uploadSchema, query);
      const fileName = sanitizeFileName(meta.filename);
      const ext = path.extname(fileName).slice(1).toLowerCase();
      const type = TYPES[ext];
      if (!type) throw validation({ filename: `extension must be one of: ${Object.keys(TYPES).join(', ')}` });
      if (body.length === 0) throw badRequest('The uploaded file is empty');
      if (body.length > config.maxUploadBytes) throw badRequest('The uploaded file is too large');
      if (!type.magic.every((byte, i) => body[i] === byte)) {
        throw validation({ filename: `file content does not look like a .${ext} file` });
      }

      const relative = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const absolute = path.join(config.uploadDir, relative);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, body, { flag: 'wx' });

      try {
        const doc = await db.document.create({
          data: {
            user_id: user.id,
            name: meta.name,
            description: meta.description,
            file_path: relative,
            file_name: fileName,
            file_extension: ext,
            file_size_in_kilobytes: Math.round((body.length / 1024) * 100) / 100,
            is_active: true,
            created_by: actor(user),
          },
        });
        return created({ data: toApi(doc) });
      } catch (err) {
        await fs.rm(absolute, { force: true }); // don't orphan the file if the insert fails
        throw err;
      }
    },
  },
  {
    method: 'GET',
    path: '/api/documents',
    auth: 'user',
    async handler({ db, user, query }) {
      const { page, limit, skip, take } = pagination(query);
      const where = {};
      if (isAdmin(user) && query.user_id) where.user_id = idParam(query, 'user_id');
      else if (!isAdmin(user)) where.user_id = user.id;
      if (!(isAdmin(user) && flag(query, 'include_inactive'))) where.is_active = true;
      const [rows, total] = await Promise.all([
        db.document.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
        db.document.count({ where }),
      ]);
      return ok({ data: rows.map(toApi), meta: pageMeta(total, page, limit) });
    },
  },
  {
    method: 'GET',
    path: '/api/documents/:id',
    auth: 'user',
    async handler({ db, user, params }) {
      return ok({ data: toApi(await loadAccessible(db, user, idParam(params))) });
    },
  },
  {
    method: 'GET',
    path: '/api/documents/:id/download',
    auth: 'user',
    async handler({ db, user, params, config }) {
      const doc = await loadAccessible(db, user, idParam(params));
      const root = path.resolve(config.uploadDir);
      const absolute = path.resolve(root, doc.file_path);
      // Defence in depth: never serve anything outside the upload directory.
      if (!absolute.startsWith(root + path.sep)) throw notFound('Document not found');
      try {
        await fs.access(absolute);
      } catch {
        throw notFound('The stored file is no longer available');
      }
      const type = TYPES[doc.file_extension];
      return sendFile({
        path: absolute,
        filename: doc.file_name,
        contentType: type ? type.mime : 'application/octet-stream',
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/documents/:id',
    auth: 'user',
    async handler({ db, user, params }) {
      const doc = await loadAccessible(db, user, idParam(params));
      await db.document.update({ where: { id: doc.id }, data: { is_active: false } });
      return noContent();
    },
  },
];

module.exports = { routes, TYPES, sanitizeFileName };
