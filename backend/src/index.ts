import fs from 'fs';
import path from 'path';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) { },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    try {
      const service = strapi.service('admin::api-token');
      if (!service) {
        console.log('BOOTSTRAP: Access Token Service not found');
        return;
      }

      const name = `Migration_${Date.now()}`;
      const token = await service.create({
        name,
        type: 'full-access',
        description: 'Bootstrap token ' + name,
        lifespan: null
      });
      console.log('BOOTSTRAP_TOKEN:', token.accessKey);

      // Write token to file for external scripts/tools to read
      const tokenPath = path.resolve(process.cwd(), 'TOKEN.txt');
      fs.writeFileSync(tokenPath, token.accessKey);
      console.log('BOOTSTRAP: Token written to', tokenPath);

      // --- NEW: Enable Public Permissions for Contact Form ---
      const publicRole = await strapi.query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      });

      if (publicRole) {
        // Fetch existing permissions
        const permissions = await strapi.service('plugin::users-permissions.permission').find({
          role: publicRole.id,
        });

        // Check if create permission already exists
        const hasPermission = permissions.some(p =>
          p.action === 'api::contact-submission.contact-submission.create'
        );

        if (!hasPermission) {
          await strapi.service('plugin::users-permissions.permission').create({
            data: {
              action: 'api::contact-submission.contact-submission.create',
              role: publicRole.id,
            },
          });
          console.log('BOOTSTRAP: Enabled Public Create Permission for Contact Submission');
        }
      }
      // -------------------------------------------------------

    } catch (error) {
      console.error('BOOTSTRAP ERROR:', error);
    }
  },
};
