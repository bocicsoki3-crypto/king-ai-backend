import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Szolgáltatás az automata jelentések küldéséhez.
 */
export async function sendSniperReport(to: string, subject: string, htmlContent: string) {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            tls: {
                rejectUnauthorized: false // JAVÍTÁS: Megkerüli a tanúsítvány hibát (self-signed certificate)
            }
        });

        const mailOptions = {
            from: `"King AI Sniper" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[EmailService] Jelentés sikeresen elküldve: ${info.messageId}`);
        return true;
    } catch (error: any) {
        console.error(`[EmailService] HIBA az email küldésekor: ${error.message}`);
        return false;
    }
}

