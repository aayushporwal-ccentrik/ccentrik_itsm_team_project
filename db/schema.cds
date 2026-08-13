namespace itsm;
 
using { cuid, managed } from '@sap/cds/common';
 
context transaction {
 
    entity Ticket : managed {
 
        key ticketID     : String;
 
        ticketNumber     : String;
        ticketType       : String;
 
        shortDescription : String;
        status           : String;
        subStatus        : String;
        priority         : String;
 
        reportedBy       : String;
        messageProcessor : String;
        supportTeam      : String;
 
        firstResponseAt  : Timestamp;
        dueAt            : Timestamp;
        completedAt      : Timestamp;
        assignedAt       : Timestamp;
 
        incidentForm : Composition of one IncidentForm
            on incidentForm.ticketID = $self.ticketID;
           
        attachments : Composition of many Attachment
            on attachments.ticketID = $self.ticketID;
    }
 
    entity IncidentForm : cuid {
 
        ticketID : String(30);
        description : LargeString;
        category1        : String;
        category2        : String;
        category3        : String;
        category4        : String;
        solutionCategory : String;
 
        impact              : String;
        urgency             : String;
        recommendedPriority : String;
 
        language   : String(50);
        isStandard : Boolean;
 
        system            : String;
        softwareComponent : String;
        softwareVersion   : String;
        supportPackage    : Integer;
        configurationItem : String;
        relatedRFC        : String;
 
        irtStatus : String;
        mptStatus : String;
 
        workingArea  : String;
        isSapRelated : Boolean;
 
    }
 
    entity Attachment : cuid, managed {
 
        @Core.ContentDisposition.Filename : fileName
        @Core.MediaType : mediaType
        content : LargeBinary;
 
        ticketID : String;
 
        mediaType   : String;
        fileName    : String;
        fileSize    : Integer;
        storagePath : String;
    }
}
 
context master {
 
    entity LookupValue : cuid, managed {
 
        lookupType  : String;
        code        : String;
        name        : String;
        description : String;
        sequence    : Integer;
        isDefault   : Boolean;
        isActive    : Boolean;
    }
 
    entity TicketCounter : managed {
        key type : String;
        lastNumber : Integer;
    }
 
    entity User : cuid, managed {
        userId   : String;
        name     : String;
        email    : String;
        isActive : Boolean;
        role     : String;
    }
}