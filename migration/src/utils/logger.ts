import chalk from 'chalk';

export const logger = {
    info: (message: string) => console.log(chalk.blue('ℹ'), message),
    success: (message: string) => console.log(chalk.green('✓'), message),
    warn: (message: string) => console.log(chalk.yellow('⚠'), message),
    error: (message: string) => console.log(chalk.red('✖'), message),
    debug: (message: string) => console.log(chalk.gray('→'), message),

    section: (title: string) => {
        console.log('');
        console.log(chalk.bold.cyan(`━━━ ${title} ━━━`));
    },

    progress: (current: number, total: number, label: string) => {
        const percent = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
        process.stdout.write(`\r${chalk.blue(bar)} ${percent}% | ${label}`);
    },

    newLine: () => console.log(''),
};
